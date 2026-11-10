-- One dental call at a time on 4010 6198 until Vocex confirms more simultaneous calls
-- (two calls placed together both failed with SIP 480 on 2026-11-10).
-- A transferred dentist keeps talking to the agent on 6198 after Anna's part ends, so a call
-- transferred in the last transfer_hold_minutes also holds the line.
-- This wraps claim_dental_call instead of replacing it: the live definition includes changes
-- that are not in the repository. Same advisory lock, so the check and the reservation can't
-- race. Raise the limit later with: UPDATE dental_dialer_runtime SET max_active_calls = 2;
-- Safe to re-run.
ALTER TABLE public.dental_dialer_runtime
  ADD COLUMN IF NOT EXISTS max_active_calls integer NOT NULL DEFAULT 1
    CHECK (max_active_calls BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS transfer_hold_minutes integer NOT NULL DEFAULT 10
    CHECK (transfer_hold_minutes BETWEEN 0 AND 60);

CREATE OR REPLACE FUNCTION public.claim_dental_call_limited(p_staff_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r dental_dialer_runtime;
BEGIN
  PERFORM pg_advisory_xact_lock(72104102);
  SELECT * INTO r FROM dental_dialer_runtime WHERE id = 1;
  IF (SELECT count(*) FROM dental_calls
      WHERE state IN ('reserved', 'started', 'uncertain')
         OR (transfer_status IN ('requested', 'agent_confirmed')
             AND coalesce(finished_at, now()) > now() - make_interval(mins => r.transfer_hold_minutes))
     ) >= r.max_active_calls THEN
    RETURN NULL;
  END IF;
  RETURN claim_dental_call(p_staff_id);
END $$;
REVOKE ALL ON FUNCTION public.claim_dental_call_limited(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_dental_call_limited(text) TO service_role;
