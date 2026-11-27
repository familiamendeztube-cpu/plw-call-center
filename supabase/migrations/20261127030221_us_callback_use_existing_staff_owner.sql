-- Applied live by Bolt on 2026-11-27 and recorded here so the repository matches the database.
-- Bolt's no-transfer claim (20261127025325) wrote the campaign owner as 'alejandro', which is not
-- a staff id: every claimed call would fail on the us_calls staff_id reference. This rewrites the
-- live claim_us_call to use Alejandro's real staff id, agent-2, and stops if that staff is missing.
-- Superseded by 20261127170000_us_second_try_without_conversation (which keeps agent-2).
DO $migration$
DECLARE definition text := pg_get_functiondef('public.claim_us_call(timestamptz)'::regprocedure);
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE id='agent-2') THEN RAISE EXCEPTION 'Existing callback owner missing'; END IF;
 IF position('v_staff text := ''alejandro'';' in definition)>0 THEN
   EXECUTE replace(definition,'v_staff text := ''alejandro'';','v_staff text := ''agent-2'';');
 END IF;
END $migration$;
