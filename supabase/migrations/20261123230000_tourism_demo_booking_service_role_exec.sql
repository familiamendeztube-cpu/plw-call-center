/*
# Grant service_role EXECUTE on the token-scoped demo booking functions

1. Problem (found by live QA smoke on the deployed edge function)
- `plw-hotel-demo` runs with the SERVICE_ROLE key and calls the public RPCs
  `book_tourism_demo_from_link` and `cancel_tourism_demo_booking`. Those functions
  were granted EXECUTE only to `anon` and `authenticated`, so every booking attempt
  from the public page failed with "permission denied for function
  book_tourism_demo_from_link" (HTTP 400). The local PGlite test harness does not
  model Supabase's function ACLs, so the tests could not catch this.

2. Change
- GRANT EXECUTE on the two token-scoped functions to `service_role`.
- Security is unchanged: both functions validate the 48-hex link token internally
  and never trust the caller's role; `anon` / `authenticated` grants stay exactly
  as before, and no table privileges are added.

3. Notes
- Idempotent grants; safe to re-run.
*/

GRANT EXECUTE ON FUNCTION public.book_tourism_demo_from_link(text, timestamptz, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_tourism_demo_booking(text, uuid) TO service_role;
