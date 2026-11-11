-- A dial that fails with SIP 404 ("number not found") hit a bad number in the list, not a
-- dentist. Owner's rule: it doesn't use up a pilot attempt, and the lead shows as a wrong
-- number. The attempt is given back by raising pilot_baseline_count (attempts = calls -
-- baseline) instead of changing the live counting functions; pilot_refunded makes it happen
-- once per call. Safe to re-run.
ALTER TABLE public.dental_calls ADD COLUMN IF NOT EXISTS pilot_refunded boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.dental_number_not_found(p_call_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c dental_calls;
BEGIN
  PERFORM pg_advisory_xact_lock(72104102);
  UPDATE dental_calls SET pilot_refunded = true
  WHERE id = p_call_id AND state = 'failed' AND NOT is_test AND NOT pilot_refunded
  RETURNING * INTO c;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE dental_agent_dialers SET pilot_baseline_count = pilot_baseline_count + 1, updated_at = now()
  WHERE staff_id = c.staff_id AND pilot_call_limit IS NOT NULL;
  UPDATE dental_leads SET status = 'wrong_number', updated_at = now()
  WHERE id = c.lead_id AND status = 'pending';
END $$;
REVOKE ALL ON FUNCTION public.dental_number_not_found(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dental_number_not_found(uuid) TO service_role;

-- Calls since 2026-11-11 store the SIP reason; give their 404 attempts back too.
SELECT public.dental_number_not_found(id) FROM public.dental_calls
WHERE state = 'failed' AND NOT is_test AND error LIKE '%SIP 404%';
