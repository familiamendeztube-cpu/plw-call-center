/*
# Session revocation for staff access

1. Plain-English summary
- Adds a revocation timestamp to each staff profile. Any sign-in issued before that moment stops working for data access immediately, even if the browser still holds it.
- Used when an administrator disables an agent, resets a PIN, or revokes access.
- Revoking also pauses the agent so no new inquiries are sent to them.

2. Modified objects
- staff_profiles: new column sessions_revoked_at (nullable).
- current_staff_id and is_admin: now also require the session to have been issued after the revocation time.
- revoke_staff_sessions: new function, callable only by the server service.

3. Security
- Access checks remain on the server database; the browser cannot change the revocation time.
- Revoked sessions lose all row access, including the ability to read their own profile, so the app signs them out.
*/

ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS sessions_revoked_at timestamptz;

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
    AND (
      s.sessions_revoked_at IS NULL
      OR (auth.jwt() ->> 'iat')::numeric > extract(epoch FROM s.sessions_revoked_at)
    )
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
      AND (
        s.sessions_revoked_at IS NULL
        OR (auth.jwt() ->> 'iat')::numeric > extract(epoch FROM s.sessions_revoked_at)
      )
  )
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
  UPDATE public.staff_presence
  SET availability = 'paused', updated_at = now()
  WHERE staff_id = p_staff_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_staff_sessions(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_staff_sessions(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.current_staff_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_staff_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
