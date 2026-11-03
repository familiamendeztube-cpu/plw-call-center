/*
# Grants and scheduler address for the new project

1. Plain-English summary
- This project does not grant table access automatically, so the server role now receives the two grants that staff logout needs.
- The every-minute Gmail scheduler now calls this project instead of the previous one.

2. Changed objects
- staff_profiles: service_role can read.
- staff_presence: service_role can read and update.
- gmail_sync_tick: the request target changes to this project. The request still carries the scheduler token from the vault.

3. Security
- No browser role gains access. RLS remains enabled on both tables.

4. Notes
- The project address stays written directly in the function, so moving to another Supabase project needs a new migration.
*/

GRANT SELECT ON public.staff_profiles TO service_role;
GRANT SELECT, UPDATE ON public.staff_presence TO service_role;

CREATE OR REPLACE FUNCTION public.gmail_sync_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token text;
  v_request bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.gmail_sync_state s WHERE s.id = 1 AND s.is_running) THEN
    RETURN NULL;
  END IF;

  SELECT s.decrypted_secret INTO v_token
  FROM vault.decrypted_secrets s
  WHERE s.name = 'gmail_sync_scheduler_secret';

  SELECT net.http_post(
    url := 'https://meagbbmittuhdgwnhvxa.supabase.co/functions/v1/google-workspace/sync/tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO v_request;

  RETURN v_request;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gmail_sync_tick() FROM PUBLIC, anon, authenticated;
