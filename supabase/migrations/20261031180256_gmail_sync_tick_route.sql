/*
# Gmail sync scheduler points at the Google function route

1. Plain-English summary
- The every-minute scheduler now calls the sync route inside the Google Workspace function, so the sync reuses the existing Google authorization and token code.

2. Changed objects
- gmail_sync_tick: the request target changes to the Google function sync route. The request still carries the scheduler token from the vault.

3. Security
- No access change. The route accepts only the scheduler token, which is verified in the database.
*/

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
    url := 'https://piynmutwibhmitdcfvyf.supabase.co/functions/v1/google-workspace/sync/tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO v_request;

  RETURN v_request;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gmail_sync_tick() FROM PUBLIC, anon, authenticated;
