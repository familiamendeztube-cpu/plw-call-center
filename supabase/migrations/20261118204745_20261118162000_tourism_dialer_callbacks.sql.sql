/*
# Tourism dialer: callbacks and captured contact fields

1. Plain-English explanation
Completes the tourism dispatcher so confirmed callbacks work exactly once and
Anna's captured contact data (email, WhatsApp, callback number, decision
maker) is stored with the call. The strict "one call per lead" index is
replaced: a lead can now have a second call only when it comes from a
confirmed callback, while duplicate protection for fresh leads is kept by the
claim query (it only picks leads with no tourism call at all) and the
one-active-call-per-phone index.

2. Modified Tables
- tourism_calls: adds details jsonb (captured fields keyed by field name).
- Index tourism_one_call_per_lead (unique on lead_id) is dropped and replaced
  by tourism_one_active_per_lead (unique on lead_id only while the call is
  reserved/started/uncertain), so a finished first call does not block the
  single confirmed-callback call, but two simultaneous calls never happen.

3. Replaced Functions
- claim_tourism_call(): now claims a due pending callback FIRST (marks it
  claimed_at in the same locked transaction - exactly-once), otherwise picks
  a fresh never-dialed lead. Callbacks ignore the fresh-lead "never dialed"
  filter by design; every other gate (window, agent presence, DNC, shared
  one-call line cap, callback promise) still applies to both paths. A
  callback call also refuses when the lead already has an active call.
*/

ALTER TABLE tourism_calls ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}';

DROP INDEX IF EXISTS tourism_one_call_per_lead;
CREATE UNIQUE INDEX IF NOT EXISTS tourism_one_active_per_lead
  ON tourism_calls(lead_id) WHERE state IN ('reserved','started','uncertain');

CREATE OR REPLACE FUNCTION claim_tourism_call(p_now timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r tourism_dialer_runtime;
  l ai_outbound_leads;
  c tourism_calls;
  v_local timestamp;
  v_staff_id text := 'agent-2';
  v_callback tourism_callbacks;
BEGIN
  PERFORM pg_advisory_xact_lock(72104104);
  SELECT * INTO r FROM tourism_dialer_runtime WHERE id = 1 FOR UPDATE;
  IF r.last_error = 'scheduler_paused' THEN RETURN NULL; END IF;
  IF r.config_verified_at IS NULL OR r.provider_agent_id IS NULL OR r.transfer_uri IS NULL THEN
    RETURN NULL;
  END IF;
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
  -- 1. Confirmed callbacks due now, claimed exactly once inside this lock.
  SELECT cb.* INTO v_callback
  FROM tourism_callbacks cb
  WHERE cb.status = 'pending' AND cb.claimed_at IS NULL AND cb.scheduled_for <= p_now
    AND NOT EXISTS (SELECT 1 FROM ai_outbound_do_not_call d WHERE d.phone = cb.phone)
    AND NOT EXISTS (SELECT 1 FROM tourism_calls t WHERE t.lead_id = cb.lead_id
                    AND t.state IN ('reserved','started','uncertain'))
    AND NOT EXISTS (SELECT 1 FROM dental_calls d2 WHERE d2.phone = cb.phone
                    AND d2.state IN ('reserved','started','uncertain'))
  ORDER BY cb.scheduled_for, cb.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF FOUND THEN
    UPDATE tourism_callbacks SET claimed_at = p_now WHERE id = v_callback.id;
    SELECT al.* INTO l FROM ai_outbound_leads al WHERE al.id = v_callback.lead_id;
    INSERT INTO tourism_calls(lead_id, campaign_id, staff_id, phone, provider_agent_id)
    VALUES (l.id, l.campaign_id, v_staff_id, l.phone, r.provider_agent_id)
    RETURNING * INTO c;
    UPDATE tourism_dialer_runtime SET dialed_today = dialed_today + 1 WHERE id = 1;
    RETURN jsonb_build_object('call', to_jsonb(c), 'lead', to_jsonb(l), 'callback', to_jsonb(v_callback));
  END IF;
  -- 2. Fresh leads of the tourism campaign: never dialed, not blocked, no open promise.
  SELECT al.* INTO l
  FROM ai_outbound_leads al
  JOIN ai_outbound_campaigns ac ON ac.id = al.campaign_id
  WHERE ac.name = 'Turismo PLW'
    AND NOT EXISTS (SELECT 1 FROM ai_outbound_do_not_call d WHERE d.phone = al.phone)
    AND NOT EXISTS (SELECT 1 FROM tourism_calls t WHERE t.lead_id = al.id)
    AND NOT EXISTS (SELECT 1 FROM dental_calls d2 WHERE d2.phone = al.phone
                    AND d2.state IN ('reserved','started','uncertain'))
    AND NOT EXISTS (SELECT 1 FROM tourism_callbacks cb WHERE cb.lead_id = al.id AND cb.status = 'pending')
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
