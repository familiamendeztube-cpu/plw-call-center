/*
# Tourism claim uses the verified agent id from the runtime row

1. Plain-English summary
   - claim_tourism_call required the caller to pass the tourism voice agent id through a
     database setting that no part of the application ever sets. Every claim therefore
     returned null: imported leads were never dialed even with the dialer started. The
     claim now falls back to the agent id saved in tourism_dialer_runtime, which only
     exists after the administrator's verified configuration and is cleared automatically
     when the verified-agent gate detects drift. The per-call setting override is kept
     for the test reservation path.

2. Security / safety
   - Same advisory lock, same eligibility rules (window, cap, presence, DNC, shared-line
     cap, one call per lead, pending-callback guard).
   - Unconfigured or unverified agent id still refuses to claim (fail closed).
   - Grants unchanged: service_role only.
*/

CREATE OR REPLACE FUNCTION claim_tourism_call(p_now timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r tourism_dialer_runtime;
  l ai_outbound_leads;
  c tourism_calls;
  v_local timestamp;
  v_agent_id text;
  v_staff_id text := 'agent-2';
BEGIN
  PERFORM pg_advisory_xact_lock(72104104);
  SELECT * INTO r FROM tourism_dialer_runtime WHERE id = 1 FOR UPDATE;
  IF r.last_error = 'scheduler_paused' THEN RETURN NULL; END IF;
  -- Daily cap resets on the Costa Rica calendar day.
  IF r.checked_at <> CURRENT_DATE THEN
    UPDATE tourism_dialer_runtime SET checked_at = CURRENT_DATE, dialed_today = 0 WHERE id = 1;
    r.dialed_today := 0;
  END IF;
  IF r.dialed_today >= r.daily_cap THEN RETURN NULL; END IF;
  v_local := p_now AT TIME ZONE 'America/Costa_Rica';
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
  -- Shared-line cap across ALL dialers: one in-flight call anywhere blocks a new claim,
  -- because the single outbound line has no verified simultaneous-call capacity.
  IF (SELECT count(*) FROM dental_calls WHERE state IN ('reserved','started','uncertain')) > 0
     OR (SELECT count(*) FROM tourism_calls WHERE state IN ('reserved','started','uncertain')) > 0 THEN
    RETURN NULL;
  END IF;
  SELECT al.* INTO l
  FROM ai_outbound_leads al
  JOIN ai_outbound_campaigns ac ON ac.id = al.campaign_id
  WHERE ac.name = 'Turismo PLW'
    AND NOT EXISTS (SELECT 1 FROM ai_outbound_do_not_call d WHERE d.phone = al.phone)
    AND NOT EXISTS (SELECT 1 FROM tourism_calls t WHERE t.lead_id = al.id)
    AND NOT EXISTS (SELECT 1 FROM dental_calls d2 WHERE d2.phone = al.phone
                    AND d2.state IN ('reserved','started','uncertain'))
    AND NOT EXISTS (
      SELECT 1 FROM tourism_callbacks cb
      WHERE cb.lead_id = al.id AND cb.status = 'pending' AND cb.claimed_at IS NULL
    )
  ORDER BY al.created_at, al.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Per-call override, then the runtime default, then the verified configuration. An
  -- unverified configuration (null provider_agent_id) refuses to claim.
  v_agent_id := coalesce(
    current_setting('app.tourism_agent_id', true),
    NULLIF(current_setting('app.tourism_agent_id_default', true), ''),
    r.provider_agent_id
  );
  IF v_agent_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO tourism_calls(lead_id, campaign_id, staff_id, phone, provider_agent_id)
  VALUES (l.id, l.campaign_id, v_staff_id, l.phone, v_agent_id)
  RETURNING * INTO c;
  UPDATE tourism_dialer_runtime SET dialed_today = dialed_today + 1 WHERE id = 1;
  RETURN jsonb_build_object('call', to_jsonb(c), 'lead', to_jsonb(l));
END $$;
REVOKE EXECUTE ON FUNCTION claim_tourism_call(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_tourism_call(timestamptz) TO service_role;
