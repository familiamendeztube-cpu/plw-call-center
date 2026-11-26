-- The owner's rule: a dental dialer can be activated or resumed only while its agent has the
-- app open and is set to Activo (heartbeat within 90 s, the same window the dialer uses).
-- After that, claim_dental_call still dials only while the agent stays Activo.
-- Wraps control_dental_dialer instead of replacing it: the live definition has changes that
-- are not in the repository. Safe to re-run.
CREATE OR REPLACE FUNCTION public.control_dental_dialer_if_active(p_staff_id text, p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo administración puede controlar el marcador.';
  END IF;
  IF p_action IN ('activate', 'resume') AND NOT EXISTS (
    SELECT 1 FROM staff_presence p
    WHERE p.staff_id = p_staff_id
      AND p.availability = 'active'
      AND p.last_heartbeat_at BETWEEN now() - interval '90 seconds' AND now() + interval '5 seconds'
  ) THEN
    RAISE EXCEPTION 'El agente debe tener la aplicación abierta y estar en Activo para activar su marcador.';
  END IF;
  PERFORM control_dental_dialer(p_staff_id, p_action);
END $$;
REVOKE ALL ON FUNCTION public.control_dental_dialer_if_active(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.control_dental_dialer_if_active(text, text) TO authenticated;
