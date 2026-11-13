ALTER TABLE public.dental_calls DROP CONSTRAINT dental_calls_outcome_check;
ALTER TABLE public.dental_calls ADD CONSTRAINT dental_calls_outcome_check CHECK (outcome = ANY (ARRAY[
  'APPOINTMENT_CONFIRMED'::text, 'APPOINTMENT_REQUESTED'::text, 'INTERESTED_FOLLOW_UP'::text,
  'WHATSAPP_INFO_REQUESTED'::text, 'EMAIL_INFO_REQUESTED'::text, 'RECEPTIONIST_CONTACT'::text,
  'DECISION_MAKER_UNAVAILABLE'::text, 'CALLBACK_REQUESTED'::text, 'NOT_INTERESTED'::text,
  'DO_NOT_CALL'::text, 'WRONG_NUMBER'::text, 'NO_ANSWER'::text, 'VOICEMAIL'::text, 'TECHNICAL_FAILURE'::text]));

ALTER TABLE public.ai_call_requests DROP CONSTRAINT ai_call_requests_preferred_contact_check;
ALTER TABLE public.ai_call_requests ADD CONSTRAINT ai_call_requests_preferred_contact_check
  CHECK (preferred_contact = ANY (ARRAY['phone'::text, 'whatsapp'::text, 'email'::text]));

CREATE OR REPLACE FUNCTION public.dental_callback_due(c public.dental_calls)
RETURNS timestamptz
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_local timestamp;
  v_due timestamptz;
BEGIN
  IF c.is_test OR c.outcome = 'EMAIL_INFO_REQUESTED'
     OR lower(COALESCE(c.details->>'callback_confirmed', '')) <> 'true' THEN
    RETURN NULL;
  END IF;
  IF COALESCE(c.details->>'callback_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR COALESCE(c.details->>'callback_clock', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_local := (c.details->>'callback_date' || ' ' || (c.details->>'callback_clock'))::timestamp;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  v_due := v_local AT TIME ZONE 'America/Costa_Rica';
  IF v_due <= now() THEN
    RETURN NULL;
  END IF;
  RETURN v_due;
END;
$$;

CREATE OR REPLACE FUNCTION public.dental_call_to_customer(p_call_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c public.dental_calls;
  l public.dental_leads;
  v_owner text;
  v_key text;
  v_prospect uuid;
  v_request uuid;
  v_callback text;
BEGIN
  SELECT * INTO c FROM public.dental_calls WHERE id = p_call_id;
  IF NOT FOUND OR c.is_test OR c.lead_id IS NULL OR c.conversation_id IS NULL
     OR c.finished_at IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT COALESCE(c.outcome IN (
       'APPOINTMENT_CONFIRMED', 'APPOINTMENT_REQUESTED', 'INTERESTED_FOLLOW_UP',
       'WHATSAPP_INFO_REQUESTED', 'EMAIL_INFO_REQUESTED', 'CALLBACK_REQUESTED'
     ), false)
     AND c.transfer_status NOT IN ('requested', 'agent_confirmed')
     AND public.dental_callback_due(c) IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(1110, hashtext(c.conversation_id));
  SELECT r.id INTO v_request FROM public.ai_call_requests r WHERE r.conversation_id = c.conversation_id;
  IF FOUND THEN
    RETURN v_request;
  END IF;

  SELECT * INTO l FROM public.dental_leads WHERE id = c.lead_id;
  v_owner := COALESCE(l.owner_staff_id, c.staff_id);
  v_key := 'dental:' || l.id;

  SELECT p.id INTO v_prospect FROM public.prospects p
  WHERE p.idempotency_key = v_key
     OR (NOT p.is_test AND right(regexp_replace(p.phone, '\D', '', 'g'), 8) = l.phone)
  ORDER BY p.idempotency_key IS NOT DISTINCT FROM v_key DESC, p.created_at DESC
  LIMIT 1;

  IF v_prospect IS NULL THEN
    INSERT INTO public.prospects (
      business_name, contact_name, phone, business_category, service_interest,
      source, idempotency_key, owner_id
    )
    VALUES (
      left(l.business_name, 160),
      left(COALESCE(c.details->>'contact_name', l.contact_name), 120),
      l.phone,
      'Clínica dental',
      left(COALESCE(c.details->>'pain_point', ''), 160),
      'ai_call',
      v_key,
      v_owner
    )
    RETURNING id INTO v_prospect;

    INSERT INTO public.conversations (prospect_id, subject) VALUES (v_prospect, left(l.business_name, 200));
    INSERT INTO public.assignment_queue (prospect_id, status, assigned_at, assigned_to)
    VALUES (v_prospect, 'assigned', now(), v_owner);
    INSERT INTO public.assignment_history (prospect_id, from_owner_id, to_owner_id, mechanism, reason)
    VALUES (v_prospect, NULL, v_owner, 'manual', 'Dentista asignado que habló con Anna');
    INSERT INTO public.notifications (staff_id, prospect_id, kind, body)
    VALUES (v_owner, v_prospect, 'assignment', left('Anna dejó un dentista para usted: ' || l.business_name, 300));
    INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
    VALUES (v_owner, v_prospect, 'assignment', left('Cliente de Anna: ' || l.business_name, 300));
  END IF;

  v_callback := regexp_replace(COALESCE(c.details->>'contact_phone', ''), '\D', '', 'g');

  INSERT INTO public.ai_call_requests (
    conversation_id, prospect_id, caller_phone, callback_phone, customer_name, business_name,
    business_type, reason, preferred_contact, preferred_time, summary, call_started_at, status
  )
  VALUES (
    c.conversation_id,
    v_prospect,
    l.phone,
    CASE WHEN char_length(v_callback) BETWEEN 8 AND 15 THEN v_callback END,
    left(c.details->>'contact_name', 120),
    left(l.business_name, 160),
    'Clínica dental',
    left(NULLIF(concat_ws(' · ', c.details->>'pain_point', c.details->>'services_interest'), ''), 500),
    CASE c.outcome
      WHEN 'WHATSAPP_INFO_REQUESTED' THEN 'whatsapp'
      WHEN 'EMAIL_INFO_REQUESTED' THEN 'email'
      ELSE 'phone'
    END,
    left(COALESCE(
      c.details->>'callback_time',
      'Visita: ' || NULLIF(concat_ws(' ', c.details->>'appointment_date', c.details->>'appointment_time'), '')
    ), 200),
    left(NULLIF(c.summary, ''), 4000),
    c.created_at,
    'pending'
  )
  RETURNING id INTO v_request;

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.dental_call_email_request(p_call_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c public.dental_calls;
  l public.dental_leads;
  v_prospect uuid;
  v_email text;
  v_contact text;
  v_title text;
  v_followup uuid;
BEGIN
  SELECT * INTO c FROM public.dental_calls WHERE id = p_call_id;
  IF NOT FOUND OR c.is_test OR c.lead_id IS NULL OR c.conversation_id IS NULL
     OR c.finished_at IS NULL OR c.outcome IS DISTINCT FROM 'EMAIL_INFO_REQUESTED' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO l FROM public.dental_leads WHERE id = c.lead_id;
  IF l.status = 'do_not_call' THEN
    RETURN NULL;
  END IF;

  SELECT r.prospect_id INTO v_prospect FROM public.ai_call_requests r WHERE r.conversation_id = c.conversation_id;
  IF v_prospect IS NULL THEN
    RETURN NULL;
  END IF;

  v_email := CASE
    WHEN btrim(COALESCE(c.details->>'contact_email', '')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    THEN left(btrim(c.details->>'contact_email'), 254)
  END;
  v_contact := left(COALESCE(
    NULLIF(btrim(COALESCE(c.details->>'decision_maker', '')), ''),
    NULLIF(btrim(COALESCE(c.details->>'contact_name', '')), ''),
    'la persona encargada'
  ), 120);
  v_title := 'Enviar información por correo a ' || v_contact || ' · ' || l.business_name
    || ' · ' || COALESCE(v_email, 'correo por confirmar');

  INSERT INTO public.followups (prospect_id, agent_id, kind, title, due_at, source_call_id)
  VALUES (v_prospect, COALESCE(l.owner_staff_id, c.staff_id), 'email', left(v_title, 200), now(), c.id)
  ON CONFLICT (source_call_id) WHERE source_call_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_followup;

  IF v_followup IS NOT NULL THEN
    INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
    VALUES (COALESCE(l.owner_staff_id, c.staff_id), v_prospect, 'followup', left('Correo pedido en llamada de Anna: ' || l.business_name, 300));
  END IF;

  RETURN v_followup;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dental_call_email_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dental_call_email_request(uuid) TO service_role;
