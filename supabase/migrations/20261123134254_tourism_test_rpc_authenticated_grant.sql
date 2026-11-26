/*
# Tourism admin test-call RPC: allow authenticated admins to execute

1. Summary
   The admin tourism test call stopped working with "Solo administración." The
   reservation function `reserve_tourism_test` verifies the caller is an
   administrator from the caller's JWT (`is_admin()`), but its EXECUTE grant
   listed only `service_role`, whose requests carry no user JWT. The edge
   function therefore could never satisfy the admin check, even for a real
   administrator.

2. Changes
   - Grant EXECUTE on `public.reserve_tourism_test(uuid, text)` to the
     `authenticated` role so a signed-in administrator's JWT reaches the
     function's own `is_admin()` check.

3. Security
   - No policy or function-body change: the function stays SECURITY DEFINER
     with its internal administrator check, so a non-admin authenticated user
     still gets "Solo administración."
   - The existing service_role grant is kept; the anon role stays excluded.
*/

REVOKE EXECUTE ON FUNCTION public.reserve_tourism_test(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_tourism_test(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_tourism_test(uuid, text) TO service_role;
