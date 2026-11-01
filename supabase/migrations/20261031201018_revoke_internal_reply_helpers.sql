/*
# Restrict internal reply and draft helpers to database owner only

1. Summary
- Internal helpers used by the outbox and draft functions were callable by the service role through default privileges. They are now revoked from every API role.

2. Security
- Revokes EXECUTE on reply_address_ok, reply_target_for, draft_save_as, and reply_send_as from service_role.
- The public wrappers (save_draft, request_reply_send, get_reply_target) and the worker functions keep their grants.
- Idempotent: REVOKE can be repeated safely.
*/

REVOKE EXECUTE ON FUNCTION public.reply_address_ok(text, text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.reply_target_for(uuid) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.draft_save_as(text, uuid, text, bigint) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.reply_send_as(text, uuid, uuid) FROM service_role;
