/*
# Authoritative Google connection version

1. Plain-English summary
- Every Google connection has a version number. A new authorization records the version it started with.
- Disconnecting clears access and advances the version in one step. Any older callback or verification that finishes later is refused and cannot save a connection.
- Saves also check the administrator's live session inside the same database transaction.

2. Modified objects
- google_workspace_connections.connection_version (new).
- google_oauth_states.connection_version (new).
- save_google_connection: locks the connection row, checks version, optional status, and live admin session, then applies the patch.
- disconnect_google_connection: checks session, clears access, advances the version, invalidates pending states, and returns the previous encrypted token.

3. Security
- Both functions are callable only by the server service role.
*/

ALTER TABLE public.google_workspace_connections
  ADD COLUMN IF NOT EXISTS connection_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.google_oauth_states
  ADD COLUMN IF NOT EXISTS connection_version integer;

CREATE OR REPLACE FUNCTION public.save_google_connection(
  p_mailbox text,
  p_expected_version integer,
  p_session_id uuid,
  p_auth_user_id uuid,
  p_staff_id text,
  p_patch jsonb,
  p_require_status text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version integer;
  v_status text;
BEGIN
  INSERT INTO public.google_workspace_connections (mailbox_address, status)
  VALUES (p_mailbox, 'disconnected')
  ON CONFLICT (mailbox_address) DO NOTHING;

  SELECT c.connection_version, c.status
  INTO v_version, v_status
  FROM public.google_workspace_connections c
  WHERE c.mailbox_address = p_mailbox
  FOR UPDATE;

  IF v_version IS DISTINCT FROM p_expected_version
     OR (p_require_status IS NOT NULL AND v_status IS DISTINCT FROM p_require_status) THEN
    RETURN 'superseded';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.resolve_staff_session(p_session_id, p_auth_user_id) AS r
    WHERE r.staff_id = p_staff_id AND r.staff_role = 'admin'
  ) THEN
    RETURN 'session-ended';
  END IF;

  UPDATE public.google_workspace_connections c SET
    status = CASE WHEN p_patch ? 'status' THEN p_patch->>'status' ELSE c.status END,
    connected_account = CASE WHEN p_patch ? 'connected_account' THEN p_patch->>'connected_account' ELSE c.connected_account END,
    connected_by = CASE WHEN p_patch ? 'connected_by' THEN p_patch->>'connected_by' ELSE c.connected_by END,
    connected_at = CASE WHEN p_patch ? 'connected_at' THEN (p_patch->>'connected_at')::timestamptz ELSE c.connected_at END,
    last_verified_at = CASE WHEN p_patch ? 'last_verified_at' THEN (p_patch->>'last_verified_at')::timestamptz ELSE c.last_verified_at END,
    last_error = CASE WHEN p_patch ? 'last_error' THEN p_patch->>'last_error' ELSE c.last_error END,
    refresh_token_ciphertext = CASE WHEN p_patch ? 'refresh_token_ciphertext' THEN p_patch->>'refresh_token_ciphertext' ELSE c.refresh_token_ciphertext END,
    scopes = CASE WHEN p_patch ? 'scopes' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'scopes')) ELSE c.scopes END,
    updated_at = now()
  WHERE c.mailbox_address = p_mailbox;

  RETURN 'saved';
END;
$$;

CREATE OR REPLACE FUNCTION public.disconnect_google_connection(
  p_mailbox text,
  p_session_id uuid,
  p_auth_user_id uuid,
  p_staff_id text
)
RETURNS TABLE (new_version integer, previous_ciphertext text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous text;
  v_version integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.resolve_staff_session(p_session_id, p_auth_user_id) AS r
    WHERE r.staff_id = p_staff_id AND r.staff_role = 'admin'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.google_workspace_connections (mailbox_address, status)
  VALUES (p_mailbox, 'disconnected')
  ON CONFLICT (mailbox_address) DO NOTHING;

  SELECT c.refresh_token_ciphertext INTO v_previous
  FROM public.google_workspace_connections c
  WHERE c.mailbox_address = p_mailbox
  FOR UPDATE;

  UPDATE public.google_workspace_connections c SET
    connection_version = c.connection_version + 1,
    status = 'disconnected',
    refresh_token_ciphertext = NULL,
    connected_account = NULL,
    connected_at = NULL,
    last_verified_at = NULL,
    scopes = '{}',
    last_error = NULL,
    updated_at = now()
  WHERE c.mailbox_address = p_mailbox
  RETURNING c.connection_version INTO v_version;

  UPDATE public.google_oauth_states SET used_at = now() WHERE used_at IS NULL;

  RETURN QUERY SELECT v_version, v_previous;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_google_connection(text, integer, uuid, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_google_connection(text, integer, uuid, uuid, text, jsonb, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.disconnect_google_connection(text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_google_connection(text, uuid, uuid, text) TO service_role;
