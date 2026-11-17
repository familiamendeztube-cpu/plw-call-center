-- Owner requested continuing toward 100 real human conversations per day instead of pausing
-- every 20 attempts. The pilot cap becomes a daily allowance: up to 500 attempts per agent
-- per day (bounded by the same 9-17 CR window, presence gate, one-call-at-a-time, opt-outs
-- and per-number attempt limits, which all still apply unchanged).
ALTER TABLE public.dental_agent_dialers DROP CONSTRAINT dental_agent_dialers_pilot_call_limit_check;
ALTER TABLE public.dental_agent_dialers
  ADD CONSTRAINT dental_agent_dialers_pilot_call_limit_check
  CHECK (pilot_call_limit >= 1 AND pilot_call_limit <= 500);

-- Today's allowance for Alejandro: room for the remaining eligible queue, subject to all gates.
UPDATE public.dental_agent_dialers
SET pilot_call_limit = 500,
    pilot_baseline_count = 0,
    last_error = '',
    updated_at = now()
WHERE staff_id = 'agent-2' AND state = 'running';

-- Stop the pilot auto-pause from ending a batch early: with the larger allowance the dialer
-- keeps the same pause-on-exhaustion behavior, just at the daily bound instead of 20.
