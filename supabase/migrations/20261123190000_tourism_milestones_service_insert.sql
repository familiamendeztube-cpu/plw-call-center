-- The dialer (service role) writes the automatic "Devolución agendada" milestone directly
-- (runner.js, upsert with ON CONFLICT DO NOTHING). 20261123150000 and 20261123184000 gave
-- service_role only SELECT, and this project has automatic grants off, so every automatic
-- write failed with 42501 and was only logged. INSERT is all ON CONFLICT DO NOTHING needs.
GRANT INSERT ON public.tourism_milestones TO service_role;
