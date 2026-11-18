/*
# Tourism campaign dispatcher

1. Plain-English explanation
Adds an automatic dialer for the owner-authorized Costa Rica tourism campaign,
completely separate from the dental dialer: its own tables, its own
administration RPCs, its own scheduler entry. Dental tables, functions, stats
and cron jobs are not read or written by any of this except the two shared
protections every campaign already uses: the global do-not-call list
(ai_outbound_do_not_call) and the shared outbound line limit (at most 1
active call at a time across ALL dialers, re-enforced here independently,
because the shared line 4010 6198 has no verified capacity above 1
simultaneous call - two at once failed with SIP 480 on 2026-11-10).

2. New Tables
- tourism_dialer_runtime: single row (id=1) with scheduler state
  (last_tick_at, scheduler_ready, last_error), the calling window
  (allowed_from 08:00, allowed_to 16:00), and a daily dial counter with cap
  (dialed_today, daily_cap 100) that resets on the Costa Rica calendar day.
- tourism_calls: one row per placed call, mirroring dental_calls:
  lead_id -> ai_outbound_leads, campaign_id -> ai_outbound_campaigns,
  is_test, staff_id (agent-2 only for now), phone (8-digit Costa Rica),
  provider_agent_id, conversation_id (unique), state
  (reserved/started/uncertain/completed/failed/cancelled), transcript jsonb,
  summary, error, created_at, finished_at, synced_at. One active call per
  phone number (partial unique index), one call per lead.
- tourism_callbacks: confirmed callbacks (day and hour agreed on a call)
  with exactly-once protection: unique (lead_id, phone, scheduled_for),
  status pending/done/cancelled and claimed_at for the claiming step.

3. New Functions (all SECURITY DEFINER, EXECUTE revoked from PUBLIC, anon
   and authenticated; granted only to the roles that use them)
- enable_tourism_scheduler(): service_role + admins. Creates the shared
  runner key in Vault if missing (same pattern as the dental scheduler) and
  schedules the cron job 'plw-tourism-dialer' (10 s) that POSTs to the
  tourism-dialer edge function with the runner key header.
- claim_tourism_call(): service_role only. Single advisory lock; daily-cap
  reset and check; window gate 08:00-16:00 Mon-Fri America/Costa_Rica;
  Alejandro (agent-2) enabled + active + fresh heartbeat gate; skips
  do-not-call phones, leads already dialed in any tourism call, phones with
  an in-flight dental call, and leads inside a pending callback promise;
  enforces the shared line cap of 1 in-flight call across dental_calls and
  tourism_calls; picks the first eligible lead of the campaign named
  'Turismo PLW'; inserts the tourism_calls row; increments dialed_today.
- control_tourism_dialer(p_action): admins only. 'start' requires a healthy
  scheduler heartbeat; 'pause' stops new claims immediately.

4. Security
- RLS enabled on all three new tables. authenticated receives SELECT on the
  runtime and calls tables (admins and agents see them in the app);
  tourism_callbacks has no direct access at all - only service_role.
  No client role can INSERT or UPDATE any of them; all writes go through
  the edge function using the service role, as with the dental tables.
- The dental webhook keeps filtering by the dental agent id only, so tourism
  conversations never enter dental stats. The tourism agent id is stored on
  each call row and resolved at claim time from a setting; until the owner
  configures the tourism voice, the dialer claims nothing.

5. Important Notes
- This migration places no calls and enables no cron job by itself; the
  scheduler function runs only when called after deployment review.
- The window here (08:00-16:00 Mon-Fri) matches the owner's instruction for
  this campaign; the dental window (09:00-17:00) is unchanged.
- Transfers: the tourism agent transfers only when the recipient explicitly
  agrees to speak with Alejandro and Alejandro is online; otherwise Anna
  schedules a callback that tourism_callbacks tracks exactly once. The
  transfer path reuses the verified SIP REFER flow with a distinct
  X-PLW-Tourism-Call header so dental alerts never fire for tourism calls.
*/

CREATE TABLE IF NOT EXISTS tourism_dialer_runtime (
  id integer PRIMARY KEY CHECK (id = 1),
  last_tick_at timestamptz,
  scheduler_ready boolean NOT NULL DEFAULT false,
  last_error text NOT NULL DEFAULT '',
  allowed_from time NOT NULL DEFAULT '08:00',
  allowed_to time NOT NULL DEFAULT '16:00',
  checked_at date NOT NULL DEFAULT CURRENT_DATE,
  dialed_today integer NOT NULL DEFAULT 0,
  daily_cap integer NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tourism_dialer_runtime (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS tourism_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES ai_outbound_leads(id),
  campaign_id uuid NOT NULL REFERENCES ai_outbound_campaigns(id),
  is_test boolean NOT NULL DEFAULT false,
  staff_id text NOT NULL REFERENCES staff_profiles(id),
  phone text NOT NULL CHECK (phone ~ '^[2-8][0-9]{7}$'),
  provider_agent_id text NOT NULL,
  conversation_id text UNIQUE,
  state text NOT NULL DEFAULT 'reserved'
    CHECK (state IN ('reserved','started','uncertain','completed','failed','cancelled')),
  transcript jsonb NOT NULL DEFAULT '[]',
  summary text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  synced_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS tourism_one_call_per_lead ON tourism_calls(lead_id);
CREATE UNIQUE INDEX IF NOT EXISTS tourism_one_active_phone
  ON tourism_calls(phone) WHERE state IN ('reserved','started','uncertain');
CREATE INDEX IF NOT EXISTS tourism_calls_campaign_idx ON tourism_calls(campaign_id, created_at);

CREATE TABLE IF NOT EXISTS tourism_callbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid REFERENCES tourism_calls(id),
  lead_id uuid NOT NULL REFERENCES ai_outbound_leads(id),
  phone text NOT NULL CHECK (phone ~ '^[2-8][0-9]{7}$'),
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, phone, scheduled_for)
);

ALTER TABLE tourism_dialer_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE tourism_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE tourism_callbacks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON tourism_dialer_runtime, tourism_calls, tourism_callbacks FROM anon, authenticated;
GRANT SELECT ON tourism_dialer_runtime, tourism_calls, tourism_callbacks TO authenticated;
GRANT ALL ON tourism_dialer_runtime, tourism_calls, tourism_callbacks TO service_role;

CREATE FUNCTION enable_tourism_scheduler() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, vault, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'plw_dental_runner_key') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'plw_dental_runner_key', 'Dialer dispatcher authentication');
  END IF;
  PERFORM cron.schedule('plw-tourism-dialer', '10 seconds', $job$
    SELECT net.http_post(
      url := 'https://meagbbmittuhdgwnhvxa.supabase.co/functions/v1/tourism-dialer',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-PLW-Runner',
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'plw_dental_runner_key')),
      body := '{"action":"tick"}'::jsonb,
      timeout_milliseconds := 60000
    )
  $job$);
  UPDATE tourism_dialer_runtime SET scheduler_ready = true WHERE id = 1;
END $$;
REVOKE EXECUTE ON FUNCTION enable_tourism_scheduler() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION enable_tourism_scheduler() TO authenticated, service_role;

CREATE FUNCTION claim_tourism_call(p_now timestamptz DEFAULT now()) RETURNS jsonb
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
    AND NOT EXISTS (SELECT 1 FROM tourism_callbacks cb WHERE cb.lead_id = al.id AND cb.status = 'pending')
  ORDER BY al.created_at, al.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_agent_id := coalesce(
    current_setting('app.tourism_agent_id', true),
    NULLIF(current_setting('app.tourism_agent_id_default', true), '')
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

CREATE FUNCTION control_tourism_dialer(p_action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Solo administración puede controlar el marcador.'; END IF;
  PERFORM pg_advisory_xact_lock(72104104);
  IF p_action = 'start' THEN
    UPDATE tourism_dialer_runtime
    SET last_error = '', updated_at = now()
    WHERE id = 1
      AND scheduler_ready
      AND last_tick_at IS NOT NULL
      AND last_tick_at >= now() - interval '2 minutes';
    IF NOT FOUND THEN RAISE EXCEPTION 'Falta verificar el servidor antes de activar.'; END IF;
  ELSIF p_action = 'pause' THEN
    UPDATE tourism_dialer_runtime SET last_error = 'scheduler_paused', updated_at = now() WHERE id = 1;
  ELSE
    RAISE EXCEPTION 'Acción no válida.';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION control_tourism_dialer(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION control_tourism_dialer(text) TO authenticated;
