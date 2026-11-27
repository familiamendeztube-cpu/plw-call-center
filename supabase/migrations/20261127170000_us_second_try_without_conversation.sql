-- Anna's US dialer: one more try for leads that never reached a conversation (owner, 2026-11-27).
--
-- Until now every lead was called once, ever. On the first live morning most calls hit voicemail
-- or the person hung up during Anna's opening, which has since been rewritten, so those leads
-- were lost. Now a lead is dialed when:
--   - it was never called (these always go first), or
--   - it was called once, that call reached no conversation, and it was on an earlier day in the
--     business's own time zone. "No conversation": the call failed or was cancelled, or it
--     completed as voicemail, no answer, a phone menu, a technical failure, or with no outcome
--     at all (the person hung up before any real exchange). A number that does not exist
--     (SIP 404) is never retried.
-- Two calls per lead at most. A lead that talked with Anna (any other outcome: not interested,
-- callback, do-not-call...) is never called again; do-not-call and pending callbacks still block.
-- Everything else is claim_us_call as it is live (Bolt's no-transfer version, owner agent-2).

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
