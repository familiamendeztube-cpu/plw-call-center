/*
# Gmail sync checkpoint: history cursor is written exactly as given

1. Plain-English summary
- The sync checkpoint previously kept the old Gmail history cursor whenever it received an empty value. That made it impossible to clear an expired cursor and take a fresh snapshot.
- The checkpoint now stores the history cursor exactly as the sync function provides it.

2. Changed objects
- gmail_sync_checkpoint: history_id is set directly from its argument.

3. Security
- No change to access. The function remains callable only by the server role and still requires a live lease and the current Google connection version.
*/

CREATE OR REPLACE FUNCTION public.gmail_sync_checkpoint(
  p_version integer,
  p_phase text,
  p_page_token text,
  p_history_id text,
  p_release boolean,
  p_error text,
  p_success boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.gmail_sync_guard(p_version) THEN RETURN false; END IF;

  UPDATE public.gmail_sync_state
  SET phase = p_phase,
      page_token = p_page_token,
      history_id = p_history_id,
      last_success_at = CASE WHEN p_success THEN now() ELSE last_success_at END,
      last_error = CASE
        WHEN p_success THEN NULL
        WHEN p_error IS NOT NULL THEN left(p_error, 300)
        ELSE last_error
      END,
      last_error_at = CASE WHEN p_error IS NOT NULL THEN now() ELSE last_error_at END,
      consecutive_failures = CASE
        WHEN p_success THEN 0
        WHEN p_error IS NOT NULL THEN consecutive_failures + 1
        ELSE consecutive_failures
      END,
      lease_until = CASE WHEN p_release THEN NULL ELSE lease_until END,
      updated_at = now()
  WHERE id = 1;

  RETURN true;
END;
$$;
