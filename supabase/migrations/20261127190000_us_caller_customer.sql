-- A business Anna called that calls PLW back (owner, 2026-11-27).
--
-- On 11-27 a plumber whose call from Anna had failed called the Hollywood number; Alejandro
-- talked with him for six minutes and saw only a number: agents cannot read the US leads, and the
-- business was not a customer, so there was no name, no notes and no SMS tab to text him from.
--
--   - us_caller(phone, answered): for the agent's phone. While the call rings it returns the
--     business (name, contact, type) and Anna's last call with it; once the agent answers it also
--     makes the business that agent's customer (or returns the existing one), so notes and the
--     SMS tab (asking permission to text on the call) are there during the call.
--   - us_lead_to_customer: the internal part that creates the customer, once per number.
--   - claim_us_call: Anna never cold-calls a number that is already a customer.
--   - The calls already answered become customers of the agent who answered.

CREATE OR REPLACE FUNCTION public.us_lead_to_customer(p_lead_id uuid, p_staff text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  l public.us_leads%ROWTYPE;
  v_key text;
  v_name text;
  v_prospect uuid;
BEGIN
  SELECT * INTO l FROM public.us_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_key := public.phone_key(l.phone_e164);
  -- Same lock as agent_create_prospect: one number never becomes two customers.
  PERFORM pg_advisory_xact_lock(1113, hashtext(v_key));
  SELECT p.id INTO v_prospect FROM public.prospects p
  WHERE NOT p.is_test AND (p.idempotency_key = 'us:' || l.id::text OR public.phone_key(p.phone) = v_key)
  ORDER BY (p.owner_id = p_staff) DESC NULLS LAST, p.created_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN v_prospect;
  END IF;

  v_name := left(COALESCE(NULLIF(btrim(l.business_name), ''), 'Negocio de EE. UU.'), 160);
  -- Same key as us_call_to_customer, so a later call with Anna finds this customer.
  INSERT INTO public.prospects (
    business_name, contact_name, phone, business_category, source, idempotency_key, owner_id, created_by
  )
  VALUES (
    v_name, left(COALESCE(l.contact_name, ''), 120), l.phone_e164,
    left(COALESCE(NULLIF(l.business_type, ''), 'Negocio EE. UU.'), 120),
    'ai_call_us', 'us:' || l.id::text, p_staff, p_staff
  )
  RETURNING id INTO v_prospect;
  INSERT INTO public.conversations (prospect_id, subject) VALUES (v_prospect, v_name);
  INSERT INTO public.assignment_queue (prospect_id, status, assigned_at, assigned_to)
  VALUES (v_prospect, 'assigned', now(), p_staff);
  INSERT INTO public.assignment_history (prospect_id, to_owner_id, mechanism, reason, actor_id)
  VALUES (v_prospect, p_staff, 'manual', 'Negocio de EE. UU. que llamó después de la llamada de Anna', p_staff);
  INSERT INTO public.activity_events (agent_id, prospect_id, kind, summary)
  VALUES (p_staff, v_prospect, 'assignment', left('Llamó después de la llamada de Anna (EE. UU.): ' || v_name, 300));
  RETURN v_prospect;
END;
$$;
REVOKE ALL ON FUNCTION public.us_lead_to_customer(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.us_caller(p_phone text, p_answered boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_me text := public.current_staff_id();
  v_key text := public.phone_key(p_phone);
  l public.us_leads%ROWTYPE;
  c public.us_calls%ROWTYPE;
  v_prospect uuid;
BEGIN
  IF v_me IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_profiles s WHERE s.id = v_me AND s.role = 'agent'
  ) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  -- Only a whole US number can match a lead.
  IF COALESCE(v_key, '') !~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO l FROM public.us_leads x
  WHERE x.dest = 'us' AND public.phone_key(x.phone_e164) = v_key
  ORDER BY x.created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO c FROM public.us_calls x
  WHERE x.lead_id = l.id AND NOT x.is_test
  ORDER BY x.created_at DESC
  LIMIT 1;

  IF p_answered THEN
    v_prospect := public.us_lead_to_customer(l.id, v_me);
    -- Another agent's customer stays theirs: the agent sees the business, not the customer.
    IF NOT COALESCE(public.can_access_prospect(v_prospect), false) THEN
      v_prospect := NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'business_name', l.business_name,
    'contact_name', COALESCE(NULLIF(c.details->>'contact_name', ''), NULLIF(l.contact_name, '')),
    'business_type', NULLIF(l.business_type, ''),
    'timezone', NULLIF(l.timezone, ''),
    'prospect_id', v_prospect,
    'anna_called_at', c.created_at,
    'outcome', c.outcome,
    'summary', NULLIF(btrim(COALESCE(c.summary, '')), '')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.us_caller(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.us_caller(text, boolean) TO authenticated;

-- claim_us_call as in 20261127170000, plus: never a number that is already a customer.
CREATE OR REPLACE FUNCTION public.claim_us_call(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_runtime public.us_dialer_runtime%ROWTYPE;
  v_lead public.us_leads%ROWTYPE;
  v_lead_id uuid;
  v_call uuid;
  -- The campaign owner of record; Anna's agreed callbacks land on his Hoy list.
  v_staff text := 'agent-2';
BEGIN
  -- Same lock as claim_tourism_call and reserve_tourism_test: one claim at a time on the line.
  PERFORM pg_advisory_xact_lock(72104104);
  SELECT * INTO v_runtime FROM public.us_dialer_runtime WHERE id = 1 FOR UPDATE;
  IF v_runtime.paused OR NOT v_runtime.scheduler_ready OR v_runtime.provider_agent_id IS NULL
     OR v_runtime.caller_e164 IS NULL
     OR v_runtime.config_verified_at IS NULL THEN
    RETURN NULL;
  END IF;
  -- Up to max_lines US calls at once. The Costa Rica dialers are stopped (outbound is US-only).
  IF (SELECT count(*) FROM public.us_calls WHERE state IN ('reserved', 'started', 'uncertain'))
     >= v_runtime.max_lines THEN
    RETURN NULL;
  END IF;
  IF v_runtime.checked_at IS DISTINCT FROM (p_now AT TIME ZONE 'America/Los_Angeles')::date THEN
    UPDATE public.us_dialer_runtime
    SET checked_at = (p_now AT TIME ZONE 'America/Los_Angeles')::date, dialed_today = 0
    WHERE id = 1;
    v_runtime.dialed_today := 0;
  END IF;
  IF v_runtime.dialed_today >= v_runtime.daily_cap THEN
    RETURN NULL;
  END IF;

  -- Fresh leads first, then one more try on a later day for leads that reached no conversation;
  -- always inside each business's calling hours. An agreed callback is Alejandro's (a follow-up
  -- on his Hoy list, made by us_call_to_customer); Anna never redials it.
  SELECT l.id INTO v_lead_id
  FROM public.us_leads l
  JOIN public.us_campaigns c ON c.id = l.campaign_id
  CROSS JOIN LATERAL (
    SELECT count(*) AS calls,
           count(*) FILTER (
             WHERE NOT (
               x.state IN ('failed', 'cancelled')
               OR (x.state = 'completed'
                   AND (x.outcome IS NULL
                        OR x.outcome IN ('VOICEMAIL', 'NO_ANSWER', 'IVR_NO_HUMAN', 'TECHNICAL_FAILURE')))
             )
             OR COALESCE(x.error, '') LIKE '%(SIP 404)%'
           ) AS final_calls,
           max(x.created_at) AS last_at
    FROM public.us_calls x
    WHERE x.lead_id = l.id
  ) h
  WHERE c.name = 'EE. UU. · Negocios en español' AND l.dest = 'us'
    AND (
      h.calls = 0
      OR (h.calls = 1 AND h.final_calls = 0
          -- last_call_at is stamped by every claim with the claim's time.
          AND (p_now AT TIME ZONE COALESCE(NULLIF(l.timezone, ''), 'America/Los_Angeles'))::date
              > (COALESCE(l.last_call_at, h.last_at) AT TIME ZONE COALESCE(NULLIF(l.timezone, ''), 'America/Los_Angeles'))::date)
    )
    AND NOT EXISTS (SELECT 1 FROM public.us_callbacks cb WHERE cb.lead_id = l.id AND cb.status = 'pending')
    AND NOT EXISTS (SELECT 1 FROM public.ai_outbound_do_not_call d WHERE d.phone = l.phone_e164)
    -- Already a customer (it called back, texted, or an agent added it): an agent follows up.
    AND NOT EXISTS (
      SELECT 1 FROM public.prospects p
      WHERE NOT p.is_test AND public.phone_key(p.phone) = public.phone_key(l.phone_e164)
    )
    AND public.us_window_open(l.timezone, p_now, v_runtime.allowed_from, v_runtime.allowed_to)
  ORDER BY h.calls, l.created_at, l.id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_lead FROM public.us_leads WHERE id = v_lead_id;
  INSERT INTO public.us_calls (lead_id, campaign_id, staff_id, phone, provider_agent_id, is_test)
  VALUES (v_lead.id, v_lead.campaign_id, v_staff, v_lead.phone_e164, v_runtime.provider_agent_id, false)
  RETURNING id INTO v_call;
  UPDATE public.us_leads SET last_call_at = p_now, updated_at = now() WHERE id = v_lead.id;
  UPDATE public.us_dialer_runtime SET dialed_today = dialed_today + 1 WHERE id = 1;
  RETURN jsonb_build_object(
    'call', jsonb_build_object('id', v_call, 'phone', v_lead.phone_e164,
                               'provider_agent_id', v_runtime.provider_agent_id,
                               'is_test', false, 'staff_id', v_staff, 'lead_id', v_lead.id),
    'lead', jsonb_build_object('id', v_lead.id, 'business_name', v_lead.business_name,
                               'contact_name', v_lead.contact_name, 'business_type', v_lead.business_type,
                               'timezone', v_lead.timezone)
  );
END $function$;

-- Calls already answered (Alejandro's on 11-27): the business becomes the answering agent's customer.
SELECT public.us_lead_to_customer(l.id, a.staff_id)
FROM (
  SELECT DISTINCT ON (public.phone_key(x.number)) x.number, x.staff_id
  FROM public.asterisk_calls x
  JOIN public.staff_profiles s ON s.id = x.staff_id AND s.role = 'agent'
  WHERE x.direction = 'inbound' AND x.disposition = 'ANSWERED' AND x.talk_seconds > 0
  ORDER BY public.phone_key(x.number), x.started_at DESC
) a
JOIN public.us_leads l ON l.dest = 'us' AND public.phone_key(l.phone_e164) = public.phone_key(a.number);
