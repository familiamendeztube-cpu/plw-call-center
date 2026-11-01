/*
# Tighten table privileges for browser roles

1. Plain-English summary
- New tables in this project receive broad default privileges for the browser roles. This migration removes them so that browsers can only read the records they are meant to see, and all changes go through the server functions.

2. Changed privileges
- anon: no table access at all. Staff sign-in and the agent directory use server functions.
- authenticated: read-only (SELECT) on the operational tables, with no insert, update, delete, or truncate anywhere.
- Credential, device, enrollment, login-attempt, and assignment cursor tables: no access for browser roles. Only the server service can read or write them.

3. Security
- Row-level security remains enabled everywhere. These grants are an additional layer, so a future policy mistake cannot expose write access.
*/

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON public.staff_credentials, public.office_devices, public.device_enrollments,
  public.auth_audit_events, public.assignment_cursor FROM authenticated;
GRANT SELECT ON public.assignment_history, public.assignment_queue, public.admin_audit_events TO authenticated;
