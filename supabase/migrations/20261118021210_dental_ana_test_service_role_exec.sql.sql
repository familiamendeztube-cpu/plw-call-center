-- Admin-only is enforced by the dental-dialer edge function (authorizeAdmin) before it calls
-- this RPC with the service-role client, matching reserve_dental_test. EXECUTE stays restricted
-- to service_role so no browser role can call it directly. Test calls never count toward
-- campaign limits, never create customers or follow-ups, and never touch the scheduler.
-- Idempotent by request id so a double submit reserves once; later deliberate tests use a new id.
CREATE OR REPLACE FUNCTION public.reserve_dental_ana_test(
  p_id uuid, p_staff_id text, p_phone text,
  p_business_name text, p_business_type text, p_contact_name text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d dental_agent_dialers; c dental_calls;
BEGIN
PERFORM pg_advisory_xact_lock(72104103);
SELECT * INTO c FROM dental_calls WHERE id = p_id;
IF FOUND THEN
  IF c.staff_id <> p_staff_id OR c.phone <> p_phone OR NOT c.is_test THEN
    RAISE EXCEPTION 'Solicitud ya utilizada.';
  END IF;
  RETURN jsonb_build_object('claimed', false, 'call', to_jsonb(c));
END IF;
SELECT * INTO d FROM dental_agent_dialers WHERE staff_id = p_staff_id;
IF NOT FOUND OR d.config_verified_at IS NULL OR d.provider_agent_id IS NULL
   OR d.transfer_uri IS NULL OR d.caller_phone_number_id IS NULL THEN
  RAISE EXCEPTION 'Configure la voz primero.';
END IF;
IF EXISTS(SELECT 1 FROM ai_outbound_do_not_call WHERE phone = p_phone) THEN
  RAISE EXCEPTION 'Número bloqueado.';
END IF;
IF EXISTS(SELECT 1 FROM dental_calls WHERE phone = p_phone AND state IN ('reserved','started','uncertain'))
   OR (SELECT count(*) FROM dental_calls WHERE state IN ('reserved','started','uncertain')) >= 4
   OR (SELECT count(*) FROM dental_calls WHERE staff_id = p_staff_id AND state IN ('reserved','started','uncertain')) >= 2 THEN
  RAISE EXCEPTION 'Hay llamadas pendientes de finalizar.';
END IF;
INSERT INTO dental_calls(id, staff_id, phone, provider_agent_id, transfer_uri, is_test)
VALUES (p_id, p_staff_id, p_phone, d.provider_agent_id, d.transfer_uri, true) RETURNING * INTO c;
RETURN jsonb_build_object('claimed', true, 'call', to_jsonb(c), 'route', to_jsonb(d),
  'lead', jsonb_build_object(
    'business_name', p_business_name,
    'business_type', p_business_type,
    'contact_name', p_contact_name));
END $$;
REVOKE EXECUTE ON FUNCTION public.reserve_dental_ana_test(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_dental_ana_test(uuid, text, text, text, text, text) TO service_role;