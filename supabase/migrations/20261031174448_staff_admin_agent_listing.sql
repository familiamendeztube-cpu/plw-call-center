/*
# Admin agent listing with disabled profiles

1. New Functions
- `admin_list_agents()` returns every agent profile (agent-1 to agent-3 and any others), including disabled ones.
- Each row shows id, display name, enabled flag, conversation capacity, and whether a PIN is configured. The stored PIN hash is never returned.

2. Security
- Runs as SECURITY DEFINER with an empty search_path.
- Returns no rows unless the caller is a current administrator session (`is_admin()`).
- EXECUTE is revoked from PUBLIC and anon and granted to authenticated only.

3. Notes
- Public agent lists keep filtering out disabled agents; this function is for the admin screen only.
*/

CREATE OR REPLACE FUNCTION public.admin_list_agents()
RETURNS TABLE(
  id text,
  display_name text,
  is_enabled boolean,
  max_active_prospects integer,
  has_pin boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    s.id,
    s.display_name,
    s.is_enabled,
    s.max_active_prospects,
    EXISTS (
      SELECT 1 FROM public.staff_credentials c
      WHERE c.staff_id = s.id AND c.kind = 'pin'
    ) AS has_pin
  FROM public.staff_profiles s
  WHERE public.is_admin() AND s.role = 'agent'
  ORDER BY s.id
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_list_agents() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_agents() TO authenticated;
