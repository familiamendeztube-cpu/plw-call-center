/*
# Mark conversations and notifications as read

1. New functions
- mark_conversation_read(p_conversation_id uuid): clears the unread flag on one conversation. Only staff who can access that conversation may call it (owner or admin).
- mark_notifications_read(): sets read_at on the calling staff member's unread notifications.

2. Security
- Both functions are SECURITY DEFINER with a fixed search_path.
- EXECUTE is revoked from PUBLIC and anon and granted to authenticated only.
- Access is checked inside each function, so no table privilege is added.

3. Notes
- Idempotent: functions are replaced and grants re-applied on every run.
*/

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Conversación no disponible.';
  END IF;
  UPDATE public.conversations SET unread = false WHERE id = p_conversation_id AND unread;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_notifications_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff text := public.current_staff_id();
  v_count integer;
BEGIN
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'Sesión no válida.';
  END IF;
  UPDATE public.notifications SET read_at = now()
  WHERE staff_id = v_staff AND read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read() TO authenticated;
