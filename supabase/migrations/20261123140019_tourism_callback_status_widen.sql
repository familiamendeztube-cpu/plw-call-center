/*
# Widen tourism callback statuses for failure and resolution

1. Summary
   The promised-callback protection stores a failed automatic attempt (with its
   real reason) and the agent's resolution on the callback row itself. The
   original status check only allowed pending/done/cancelled, so the new
   lifecycle states `failed` and `resolved` need to be allowed.

2. Changes
   - Replace `tourism_callbacks_status_check` with a wider list:
     pending, done, cancelled, failed, resolved.

3. Security
   - No grants or policy changes; a check constraint only.
*/

ALTER TABLE public.tourism_callbacks DROP CONSTRAINT tourism_callbacks_status_check;
ALTER TABLE public.tourism_callbacks ADD CONSTRAINT tourism_callbacks_status_check
CHECK (status IN ('pending','done','cancelled','failed','resolved'));
