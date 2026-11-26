/*
# Tourism dialer: correct test-call shape

tourism_calls.lead_id and campaign_id were NOT NULL, so a test call (which
belongs to no lead) could not be inserted. Mirrors the dental rule: a test
call has NULL lead and campaign, a real call has both.
*/
ALTER TABLE tourism_calls ALTER COLUMN lead_id DROP NOT NULL;
ALTER TABLE tourism_calls ALTER COLUMN campaign_id DROP NOT NULL;
ALTER TABLE tourism_calls DROP CONSTRAINT IF EXISTS tourism_calls_check;
ALTER TABLE tourism_calls ADD CONSTRAINT tourism_calls_lead_shape
  CHECK ((is_test AND lead_id IS NULL AND campaign_id IS NULL)
     OR (NOT is_test AND lead_id IS NOT NULL AND campaign_id IS NOT NULL));

CREATE OR REPLACE FUNCTION public.reserve_tourism_test(p_id uuid, p_phone text) RETURNS jsonb
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
INSERT INTO tourism_calls(id, is_test, staff_id, phone, provider_agent_id)
VALUES (p_id, true, 'agent-2', p_phone, r.provider_agent_id)
RETURNING * INTO c;
RETURN jsonb_build_object('claimed', true, 'call', to_jsonb(c));
END $$;
REVOKE EXECUTE ON FUNCTION public.reserve_tourism_test(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_tourism_test(uuid, text) TO service_role;
