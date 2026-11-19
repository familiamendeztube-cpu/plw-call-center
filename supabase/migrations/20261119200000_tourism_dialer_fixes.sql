/*
# Tourism dialer fixes (review 2026-11-19)

1. Explicit pause flag: tourism_dialer_runtime.paused (default true). The pause used to live
   in last_error = 'scheduler_paused', so anything that cleared the error (Configurar,
   Reconfigurar) silently resumed dialing, and the first Configurar started dialing with no
   Iniciar. THIS MIGRATION PAUSES THE DIALER: press Iniciar once afterwards.
2. claim_tourism_call
   - restores the due-callback path that 20261118212259 and 20261118212606 dropped when they
     rebuilt the function from the first version: confirmed callbacks were saved, the lead
     was then excluded forever, and nobody called back;
   - claims a callback exactly once (status 'done' + claimed_at in the same locked
     transaction) and cancels pending callbacks for numbers on the do-not-call list;
   - requires the verified configuration again (config_verified_at, provider_agent_id,
     transfer_uri) and no longer reads the app.tourism_agent_id session settings, which
     nothing sets;
   - resets the daily counter on the Costa Rica calendar day, not the server's UTC day.
3. tourism_calls.outcome: the runner has always written it together with details, and the
   missing column made that whole update fail, so captured emails and WhatsApp numbers were
   lost.
4. tourism_call_to_customer (service_role only): an interested call becomes one Clientes
   entry for Alejandro (notification + assignment) and one pending Llamada request, the
   same path dental calls used (dental_call_to_customer). Idempotent per conversation.
5. enable_tourism_scheduler: service_role only. It was granted to every signed-in user and
   had no admin check; the configure action already calls it with the service role.
*/

ALTER TABLE tourism_dialer_runtime ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT true;
UPDATE tourism_dialer_runtime
SET paused = true,
    last_error = CASE WHEN last_error = 'scheduler_paused' THEN '' ELSE last_error END
WHERE id = 1;

ALTER TABLE tourism_calls ADD COLUMN IF NOT EXISTS outcome text;

CREATE OR REPLACE FUNCTION claim_tourism_call(p_now timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r tourism_dialer_runtime;
  l ai_outbound_leads;
  c tourism_calls;
  cb tourism_callbacks;
  v_local timestamp := p_now AT TIME ZONE 'America/Costa_Rica';
  v_staff_id text := 'agent-2';
BEGIN
  PERFORM pg_advisory_xact_lock(72104104);
  SELECT * INTO r FROM tourism_dialer_runtime WHERE id = 1 FOR UPDATE;
  IF r.paused OR r.config_verified_at IS NULL OR r.provider_agent_id IS NULL
     OR r.transfer_uri IS NULL THEN
    RETURN NULL;
  END IF;
  IF r.checked_at <> v_local::date THEN
    UPDATE tourism_dialer_runtime SET checked_at = v_local::date, dialed_today = 0 WHERE id = 1;
    r.dialed_today := 0;
  END IF;
  IF r.dialed_today >= r.daily_cap THEN RETURN NULL; END IF;
  IF extract(isodow FROM v_local) > 5
     OR v_local::time < r.allowed_from
     OR v_local::time >= r.allowed_to THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM staff_profiles s
    JOIN staff_presence p ON p.staff_id = s.id
    WHERE s.id = v_staff_id AND s.is_enabled AND s.role = 'agent'
      AND p.availability = 'active' AND p.operational IS NULL
      AND p.last_heartbeat_at BETWEEN p_now - interval '90 seconds' AND p_now + interval '5 seconds'
  ) THEN
    RETURN NULL;
  END IF;
  -- Shared line: one in-flight call anywhere (dental or tourism) blocks a new claim.
  IF EXISTS (SELECT 1 FROM dental_calls WHERE state IN ('reserved','started','uncertain'))
     OR EXISTS (SELECT 1 FROM tourism_calls WHERE state IN ('reserved','started','uncertain')) THEN
    RETURN NULL;
  END IF;

  -- A number that opted out since the callback was agreed is never called back.
  UPDATE tourism_callbacks t SET status = 'cancelled'
  WHERE t.status = 'pending'
    AND EXISTS (SELECT 1 FROM ai_outbound_do_not_call d WHERE d.phone = t.phone);

  -- 1. Confirmed callbacks that are due, each claimed exactly once.
  SELECT t.* INTO cb
  FROM tourism_callbacks t
  WHERE t.status = 'pending' AND t.claimed_at IS NULL AND t.scheduled_for <= p_now
  ORDER BY t.scheduled_for, t.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF FOUND THEN
    UPDATE tourism_callbacks SET status = 'done', claimed_at = p_now WHERE id = cb.id;
    SELECT * INTO l FROM ai_outbound_leads WHERE id = cb.lead_id;
    INSERT INTO tourism_calls(lead_id, campaign_id, staff_id, phone, provider_agent_id)
    VALUES (l.id, l.campaign_id, v_staff_id, cb.phone, r.provider_agent_id)
    RETURNING * INTO c;
    UPDATE tourism_dialer_runtime SET dialed_today = dialed_today + 1 WHERE id = 1;
    RETURN jsonb_build_object('call', to_jsonb(c), 'lead', to_jsonb(l), 'callback', to_jsonb(cb));
  END IF;

  -- 2. Fresh leads of the tourism campaign: never dialed, not blocked, no open callback.
  SELECT al.* INTO l
  FROM ai_outbound_leads al
  JOIN ai_outbound_campaigns ac ON ac.id = al.campaign_id
  WHERE ac.name = 'Turismo PLW'
    AND NOT EXISTS (SELECT 1 FROM ai_outbound_do_not_call d WHERE d.phone = al.phone)
    AND NOT EXISTS (SELECT 1 FROM tourism_calls t WHERE t.lead_id = al.id)
    AND NOT EXISTS (SELECT 1 FROM tourism_callbacks t WHERE t.lead_id = al.id AND t.status = 'pending')
  ORDER BY al.created_at, al.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO tourism_calls(lead_id, campaign_id, staff_id, phone, provider_agent_id)
  VALUES (l.id, l.campaign_id, v_staff_id, l.phone, r.provider_agent_id)
  RETURNING * INTO c;
  UPDATE tourism_dialer_runtime SET dialed_today = dialed_today + 1 WHERE id = 1;
  RETURN jsonb_build_object('call', to_jsonb(c), 'lead', to_jsonb(l));
END $$;
REVOKE EXECUTE ON FUNCTION claim_tourism_call(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_tourism_call(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION control_tourism_dialer(p_action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Solo administración puede controlar el marcador.'; END IF;
  PERFORM pg_advisory_xact_lock(72104104);
  IF p_action = 'start' THEN
    UPDATE tourism_dialer_runtime
    SET paused = false, last_error = '', updated_at = now()
    WHERE id = 1
      AND scheduler_ready
      AND config_verified_at IS NOT NULL
      AND last_tick_at >= now() - interval '2 minutes';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Falta verificar la voz o el latido del servidor antes de activar.';
    END IF;
  ELSIF p_action = 'pause' THEN
    UPDATE tourism_dialer_runtime SET paused = true, updated_at = now() WHERE id = 1;
  ELSE
    RAISE EXCEPTION 'Acción no válida.';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION control_tourism_dialer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION control_tourism_dialer(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION enable_tourism_scheduler() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION enable_tourism_scheduler() TO service_role;

CREATE OR REPLACE FUNCTION public.tourism_call_to_customer(p_call_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
       'EMAIL_INFO_REQUESTED', 'CALLBACK_REQUESTED'
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
    -- concat_ws skips the NULL parts, so only the fields Anna captured appear.
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
