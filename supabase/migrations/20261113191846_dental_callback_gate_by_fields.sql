CREATE OR REPLACE FUNCTION public.dental_callback_due(c public.dental_calls)
RETURNS timestamptz
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_local timestamp;
  v_due timestamptz;
BEGIN
  IF c.is_test OR lower(COALESCE(c.details->>'callback_confirmed', '')) <> 'true' THEN
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

REVOKE EXECUTE ON FUNCTION public.dental_callback_due(public.dental_calls) FROM PUBLIC, anon, authenticated;

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
       'WHATSAPP_INFO_REQUESTED', 'CALLBACK_REQUESTED'
     ), false)
     AND c.transfer_status NOT IN ('requested', 'agent_confirmed')
     AND public.dental_callback_due(c) IS NULL THEN
    RETURN NULL;
  END IF;

  -- Same lock as record_ai_call: one request per ElevenLabs conversation.
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

  -- Only a number the dentist authorized, digits only, fits the callback column.
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
    CASE WHEN c.outcome = 'WHATSAPP_INFO_REQUESTED' THEN 'whatsapp' ELSE 'phone' END,
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

CREATE OR REPLACE FUNCTION public.dental_call_schedule_callback(p_call_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c public.dental_calls;
  l public.dental_leads;
  v_prospect uuid;
  v_due timestamptz;
  v_local timestamp;
  v_decision text;
  v_title text;
  v_followup uuid;
BEGIN
  SELECT * INTO c FROM public.dental_calls WHERE id = p_call_id;
  IF NOT FOUND OR c.lead_id IS NULL OR c.conversation_id IS NULL THEN
    RETURN NULL;
  END IF;
  v_due := public.dental_callback_due(c);
  IF v_due IS NULL THEN
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

  v_local := v_due AT TIME ZONE 'America/Costa_Rica';
  v_decision := left(NULLIF(btrim(COALESCE(c.details->>'decision_maker', '')), ''), 120);
  v_title := 'Llamar a ' || COALESCE(v_decision, 'la persona encargada') || ' · ' || l.business_name;
  IF extract(isodow FROM v_local) > 5 OR v_local::time < time '09:00' OR v_local::time >= time '17:00' THEN
    v_title := 'FUERA DE HORARIO: confirmar otra hora con el cliente (ninguna llamada automática) · ' || v_title;
  END IF;

  INSERT INTO public.followups (prospect_id, agent_id, kind, title, due_at, source_call_id)
  VALUES (v_prospect, COALESCE(l.owner_staff_id, c.staff_id), 'callback', left(v_title, 200), v_due, c.id)
  ON CONFLICT (source_call_id) WHERE source_call_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_followup;

  IF v_followup IS NOT NULL THEN
    INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
    VALUES (COALESCE(l.owner_staff_id, c.staff_id), v_prospect, 'followup', left('Seguimiento de llamada de Anna: ' || v_title, 300));
  END IF;

  RETURN v_followup;
END;
$$;
