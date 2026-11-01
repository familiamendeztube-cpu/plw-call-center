/*
# Remove unused presence column grant

1. Plain-English summary
- Removes a column-level write grant on staff presence that was added by mistake. Presence is written only through the server functions, so clients should have no direct write access.

2. Modified objects
- staff_presence: revokes UPDATE on last_heartbeat_at and updated_at from the signed-in role.

3. Security
- Tightens direct write access. No data is changed.
*/

REVOKE UPDATE (last_heartbeat_at, updated_at) ON public.staff_presence FROM authenticated;
