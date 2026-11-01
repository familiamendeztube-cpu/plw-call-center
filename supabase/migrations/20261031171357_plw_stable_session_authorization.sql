/*
# Stable session authorization for staff and Google connection

1. Plain-English summary
- Access is now tied to the login session itself, not to the token's issue time. A refreshed token keeps its session, so it cannot restore access after a revocation. A new sign-in creates a new session and works normally.
- Revoking a staff member deletes only that person's login sessions, voids their pending Google authorizations, and pauses them. Administrator sessions are not touched.

2. Modified objects
- google_oauth_states: new column session_id (the login session that started the Google authorization).
- jwt_session_is_current: new helper used by current_staff_id and is_admin.
- current_staff_id and is_admin: use the session check.
- resolve_staff_session: new, callable only by the server service role.
- revoke_staff_sessions: deletes the target's sessions and pending authorizations.

3. Security
- No table privileges are added. The helper and resolver are not callable by browser roles.
*/

ALTER TABLE public.google_oauth_states ADD COLUMN IF NOT EXISTS session_id uuid;

CREATE OR REPLACE FUNCTION public.jwt_session_is_current(p_revoked_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.sessions ss
    WHERE ss.id = (auth.jwt() ->> 'session_id')::uuid
      AND ss.user_id = auth.uid()
      AND (ss.not_after IS NULL OR ss.not_after > now())
      AND (p_revoked_at IS NULL OR ss.created_at > p_revoked_at)
  )
$$;

CREATE OR REPLACE FUNCTION public.current_staff_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id
  FROM public.staff_profiles s
  WHERE s.auth_user_id = auth.uid()
    AND s.is_enabled
    AND public.jwt_session_is_current(s.sessions_revoked_at)
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_profiles s
    WHERE s.auth_user_id = auth.uid()
      AND s.is_enabled
      AND s.role = 'admin'
      AND public.jwt_session_is_current(s.sessions_revoked_at)
  )
$$;

CREATE OR REPLACE FUNCTION public.resolve_staff_session(p_session_id uuid, p_auth_user_id uuid)
RETURNS TABLE (staff_id text, staff_role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id, s.role
  FROM public.staff_profiles s
  JOIN auth.sessions ss ON ss.user_id = s.auth_user_id
  WHERE ss.id = p_session_id
    AND s.auth_user_id = p_auth_user_id
    AND s.is_enabled
    AND (ss.not_after IS NULL OR ss.not_after > now())
    AND (s.sessions_revoked_at IS NULL OR ss.created_at > s.sessions_revoked_at)
$$;

CREATE OR REPLACE FUNCTION public.revoke_staff_sessions(p_staff_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.staff_profiles
  SET sessions_revoked_at = now(), updated_at = now()
  WHERE id = p_staff_id;

  DELETE FROM auth.sessions
  WHERE user_id = (
    SELECT s.auth_user_id
    FROM public.staff_profiles s
    WHERE s.id = p_staff_id AND s.auth_user_id IS NOT NULL
  );

  UPDATE public.google_oauth_states
  SET used_at = now()
  WHERE staff_id = p_staff_id AND used_at IS NULL;

  UPDATE public.staff_presence
  SET availability = 'paused', updated_at = now()
  WHERE staff_id = p_staff_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.jwt_session_is_current(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_staff_session(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_staff_session(uuid, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.revoke_staff_sessions(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_staff_sessions(text) TO service_role;
