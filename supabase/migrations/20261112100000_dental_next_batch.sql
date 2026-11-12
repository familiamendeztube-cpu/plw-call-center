-- Owner's rule (2026-11-12): Anna calls in batches of 20, and the admin starts the next batch
-- from the app as soon as the current one is used up (before, it took a SQL edit).
-- A batch is the existing pilot budget: pilot_call_limit attempts counted from
-- pilot_baseline_count. Starting the next one moves the baseline to the attempts made so far,
-- then activates through control_dental_dialer_if_active, so every activation rule still
-- applies (agent Activo with the app open, Ana verified, fresh server signal). If activation
-- is refused, nothing changes. Wraps instead of replacing: the live control functions differ
-- from the repository. Safe to re-run.
CREATE OR REPLACE FUNCTION public.start_next_dental_batch(p_staff_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d dental_agent_dialers;
  v_used bigint;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo administración puede controlar el marcador.';
  END IF;
  PERFORM pg_advisory_xact_lock(72104102);
  SELECT * INTO d FROM dental_agent_dialers WHERE staff_id = p_staff_id FOR UPDATE;
  IF NOT FOUND OR d.pilot_call_limit IS NULL THEN
    RAISE EXCEPTION 'Este marcador no trabaja por tandas.';
  END IF;
  SELECT count(*) INTO v_used FROM dental_calls WHERE staff_id = p_staff_id AND NOT is_test;
  IF v_used < d.pilot_baseline_count + d.pilot_call_limit THEN
    RAISE EXCEPTION 'La tanda actual todavía tiene intentos. Use Continuar.';
  END IF;
  UPDATE dental_agent_dialers
  SET pilot_baseline_count = v_used, pilot_started_at = now(), updated_at = now()
  WHERE staff_id = p_staff_id;
  PERFORM control_dental_dialer_if_active(p_staff_id, 'activate');
END $$;
REVOKE ALL ON FUNCTION public.start_next_dental_batch(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_next_dental_batch(text) TO authenticated;
