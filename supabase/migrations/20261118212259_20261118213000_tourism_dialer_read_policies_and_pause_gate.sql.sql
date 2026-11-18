/*
# Tourism dialer: browser read policies, safe pause, later callback guard

1. Plain-English summary
   - The administrator's browser could not see the tourism dialer status even though
     configuration succeeded: the three tourism tables had row level security enabled
     with a SELECT grant but NO policies, so every read returned zero rows and the
     panel stayed "Sin configurar" without an Iniciar button. Read-only policies for
     signed-in administrators fix the status display.
   - Starting the dialer no longer clears a pause that is already recorded. The server
     heartbeat used to wipe 'scheduler_paused' from last_error on its next tick, which
     could resume dialing on its own. Only the administrator's Start/Pause buttons
     change the paused state now.
   - Leads already queued for a confirmed-but-pending callback in a finished call are
     skipped by the claim, mirroring the dental dialer's callback protection.

2. Security changes
   - New SELECT policies on tourism_dialer_runtime, tourism_calls and tourism_callbacks
     for the authenticated role (the panel is admin-only and its page already gates on
     the administrator session). No INSERT/UPDATE/DELETE is granted to browsers: writes
     stay with service_role only, so the calling rules cannot be changed from a browser.
   - claim_tourism_call and control_tourism_dialer keep their exact previous grants.
   - No new roles, no broader grants, no dental changes.

3. Notes
   - The 'start' action still requires scheduler_ready and a heartbeat in the last two
     minutes, and still refuses when the configuration was never verified.
   - The cron heartbeat now only clears unexpected errors, never the pause marker.
*/

DROP POLICY IF EXISTS "admin_select_tourism_dialer_runtime" ON tourism_dialer_runtime;
CREATE POLICY "admin_select_tourism_dialer_runtime" ON tourism_dialer_runtime FOR SELECT
TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "admin_select_tourism_calls" ON tourism_calls;
CREATE POLICY "admin_select_tourism_calls" ON tourism_calls FOR SELECT
TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "admin_select_tourism_callbacks" ON tourism_callbacks;
CREATE POLICY "admin_select_tourism_callbacks" ON tourism_callbacks FOR SELECT
TO authenticated USING (is_admin());

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

CREATE OR REPLACE FUNCTION control_tourism_dialer(p_action text) RETURNS void
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
