/*
# Remove direct write grants on the Gmail outbox

1. Changed table
- `gmail_outbox`: staff browsers may only read their own rows.

2. Security changes
- REVOKE INSERT, UPDATE, DELETE on `gmail_outbox` from `authenticated`.
- Writes already happen only inside SECURITY DEFINER functions (`request_reply_send`, `gmail_outbox_claim`, `gmail_outbox_set_headers`, `gmail_outbox_settle`), which run their own ownership and token checks.
- The SELECT grant and its own-row policy are unchanged.

3. Notes
- Idempotent: revoking a privilege that is not held is a no-op.
- No data is changed.
*/

REVOKE INSERT, UPDATE, DELETE ON public.gmail_outbox FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.gmail_outbox FROM anon;
