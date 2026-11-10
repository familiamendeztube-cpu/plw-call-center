-- The phone panel's recent calls lived only in browser memory, so a page refresh emptied
-- them. The server already records every call in asterisk_calls; let each agent read
-- their own rows (admins read all). Safe to re-run.
GRANT SELECT ON public.asterisk_calls TO authenticated;
DROP POLICY IF EXISTS asterisk_calls_read ON public.asterisk_calls;
CREATE POLICY asterisk_calls_read ON public.asterisk_calls FOR SELECT TO authenticated
  USING (is_admin() OR staff_id = current_staff_id());
