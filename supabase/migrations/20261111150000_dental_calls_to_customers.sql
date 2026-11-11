/*
# A dentist who wanted something after talking to Anna becomes a customer in Clientes

1. Plain-English summary
- Owner's request (2026-11-11): when Anna's call goes well, the dentist must show up in the
  agent's Clientes tab so the agent knows to act.
- "Went well" = the dentist was interested (visit, follow-up, WhatsApp info), asked to be
  called back, or Anna transferred the call. Voicemail, receptionists and no-answers stay on
  the dentist list as "Volver a llamar"; they do not become customers.
- The customer goes to the dentist's own agent (the lead owner), never to round-robin: Anna
  already offered that agent by name.
- The call is saved as an AI request, so the customer's "Llamada" tab shows Anna's summary
  and the recording, and the agent's Clientes banner lists it as pending.
- One customer per dentist: a second good call, or a dentist already in Clientes with the
  same number, joins the existing customer and keeps its agent.
- Calls Anna already made are processed once at the end of this file, for dentists still
  marked Interesado or Volver a llamar.

2. Changed objects
- New function dental_call_to_customer (server only). Safe to call repeatedly: the
  ElevenLabs conversation id is unique in ai_call_requests.

3. Security
- No browser grants. The dental-dialer Edge Function (service role) calls it after syncing a
  finished call. Agents see the result through the existing ai_call_requests and prospects
  row-level security.
*/

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
     AND c.transfer_status NOT IN ('requested', 'agent_confirmed') THEN
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

REVOKE EXECUTE ON FUNCTION public.dental_call_to_customer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dental_call_to_customer(uuid) TO service_role;

-- Calls Anna already made: dentists nobody has worked yet show up in Clientes now.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.id FROM public.dental_calls c
    JOIN public.dental_leads l ON l.id = c.lead_id
    WHERE l.status IN ('interested', 'callback')
    ORDER BY c.created_at
  LOOP
    PERFORM public.dental_call_to_customer(r.id);
  END LOOP;
END $$;
