/*
# Demo-agreed tourism calls also become customers

1. Plain-English
   - `tourism_call_to_customer` converts an interested call into exactly one
     Clientes row. Its interested-outcome list predates the demo flow, so a
     call that ended with DEMO_SCHEDULED (the person confirmed a demo day and
     time) created no customer — yet a demo agreement is strong interest and
     the demo-agreed slot milestone needs the customer row to attach to.
   - This adds DEMO_SCHEDULED to the interested outcomes. Everything else
     (idempotency per conversation, assignment to the call's agent, the pending
     request) is unchanged.

2. Modified functions
   - `public.tourism_call_to_customer(uuid)`: outcome list now includes
     'DEMO_SCHEDULED'.

3. Security
   - Unchanged: service_role only, SECURITY DEFINER.
*/
CREATE OR REPLACE FUNCTION public.tourism_call_to_customer(p_call_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c public.tourism_calls;
  l public.ai_outbound_leads;
  v_key text;
  v_type text;
  v_prospect uuid;
  v_request uuid;
  v_callback text;
BEGIN
  SELECT * INTO c FROM public.tourism_calls WHERE id = p_call_id;
  IF NOT FOUND OR c.is_test OR c.lead_id IS NULL OR c.conversation_id IS NULL
     OR c.finished_at IS NULL
     OR NOT COALESCE(c.outcome IN (
       'APPOINTMENT_CONFIRMED', 'INTERESTED_FOLLOW_UP', 'WHATSAPP_INFO_REQUESTED',
       'EMAIL_INFO_REQUESTED', 'CALLBACK_REQUESTED', 'DEMO_SCHEDULED'
     ), false) THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(1110, hashtext(c.conversation_id));
  SELECT r.id INTO v_request FROM public.ai_call_requests r WHERE r.conversation_id = c.conversation_id;
  IF FOUND THEN
    RETURN v_request;
  END IF;

  SELECT * INTO l FROM public.ai_outbound_leads WHERE id = c.lead_id;
  v_key := 'tourism:' || l.id;
  v_type := left(COALESCE(NULLIF(l.business_type, ''), 'Turismo'), 120);

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
      left(COALESCE(NULLIF(l.business_name, ''), 'Negocio de turismo'), 160),
      left(COALESCE(NULLIF(c.details->>'contact_name', ''), l.contact_name), 120),
      l.phone,
      v_type,
      left(COALESCE(c.details->>'interest', ''), 160),
      'ai_call',
      v_key,
      c.staff_id
    )
    RETURNING id INTO v_prospect;

    INSERT INTO public.conversations (prospect_id, subject)
    VALUES (v_prospect, left(COALESCE(NULLIF(l.business_name, ''), 'Negocio de turismo'), 200));
    INSERT INTO public.assignment_queue (prospect_id, status, assigned_at, assigned_to)
    VALUES (v_prospect, 'assigned', now(), c.staff_id);
    INSERT INTO public.assignment_history (prospect_id, from_owner_id, to_owner_id, mechanism, reason)
    VALUES (v_prospect, NULL, c.staff_id, 'manual', 'Negocio de turismo que habló con Anna');
    INSERT INTO public.notifications (staff_id, prospect_id, kind, body)
    VALUES (c.staff_id, v_prospect, 'assignment',
            left('Anna dejó un negocio de turismo para usted: ' || l.business_name, 300));
    INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
    VALUES (c.staff_id, v_prospect, 'assignment', left('Cliente de Anna (turismo): ' || l.business_name, 300));
  END IF;

  v_callback := regexp_replace(
    COALESCE(NULLIF(c.details->>'callback_phone', ''), c.details->>'whatsapp_number', ''), '\D', '', 'g');

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
    v_type,
    left(NULLIF(concat_ws(' · ',
      c.details->>'interest',
      'Correo: ' || (c.details->>'contact_email'),
      'WhatsApp: ' || (c.details->>'whatsapp_number'),
      'Decide: ' || (c.details->>'decision_maker')
    ), ''), 500),
    CASE c.outcome
      WHEN 'WHATSAPP_INFO_REQUESTED' THEN 'whatsapp'
      WHEN 'EMAIL_INFO_REQUESTED' THEN 'email'
      ELSE 'phone'
    END,
    left(NULLIF(concat_ws(' ', c.details->>'callback_date', c.details->>'callback_clock'), ''), 200),
    left(NULLIF(c.summary, ''), 4000),
    c.created_at,
    'pending'
  )
  RETURNING id INTO v_request;

  RETURN v_request;
END;
$$;
REVOKE ALL ON FUNCTION public.tourism_call_to_customer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tourism_call_to_customer(uuid) TO service_role;
