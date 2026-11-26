/*
# Tourism dialer: admin test-call reservation

Adds reserve_tourism_test: an administrator dials any Costa Rica number with
the dedicated tourism agent (same multilingual bookings pitch as production).
Test calls never count toward the daily cap, never create callbacks, and are
skipped by the claim function (is_test). Idempotent by request id so a double
submit reserves once. Mirrors reserve_dental_ana_test without the dental
scheduler counters: the shared one-active-call-per-phone and DNC protections
still apply.
*/
CREATE OR REPLACE FUNCTION public.reserve_tourism_test(
  p_id uuid, p_phone text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r tourism_dialer_runtime; c tourism_calls;
BEGIN
IF NOT is_admin() THEN RAISE EXCEPTION 'Solo administración.'; END IF;
PERFORM pg_advisory_xact_lock(72104104);
SELECT * INTO c FROM tourism_calls WHERE id = p_id;
IF FOUND THEN
  IF c.phone <> p_phone OR NOT c.is_test THEN RAISE EXCEPTION 'Solicitud ya utilizada.'; END IF;
  RETURN jsonb_build_object('claimed', false, 'call', to_jsonb(c));
END IF;
SELECT * INTO r FROM tourism_dialer_runtime WHERE id = 1 FOR UPDATE;
IF r.config_verified_at IS NULL OR r.provider_agent_id IS NULL OR r.transfer_uri IS NULL THEN
  RAISE EXCEPTION 'Configure la voz primero.';
END IF;
IF EXISTS(SELECT 1 FROM ai_outbound_do_not_call WHERE phone = p_phone) THEN
  RAISE EXCEPTION 'Número bloqueado.';
END IF;
IF EXISTS(SELECT 1 FROM tourism_calls WHERE phone = p_phone AND state IN ('reserved','started','uncertain'))
   OR EXISTS(SELECT 1 FROM dental_calls WHERE phone = p_phone AND state IN ('reserved','started','uncertain')) THEN
  RAISE EXCEPTION 'Hay llamadas pendientes de finalizar.';
END IF;
INSERT INTO tourism_calls(id, lead_id, campaign_id, is_test, staff_id, phone, provider_agent_id)
VALUES (p_id, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, true, 'agent-2', p_phone, r.provider_agent_id)
RETURNING * INTO c;
RETURN jsonb_build_object('claimed', true, 'call', to_jsonb(c));
END $$;
REVOKE EXECUTE ON FUNCTION public.reserve_tourism_test(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_tourism_test(uuid, text) TO service_role;
