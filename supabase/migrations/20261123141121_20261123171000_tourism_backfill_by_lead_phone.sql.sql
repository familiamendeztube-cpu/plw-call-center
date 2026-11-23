/*
# Correct the failed-promise backfill to match by lead and phone

1. Plain-English
   - The first backfill marked a promised callback "failed" only when the SAME
     call row that created the promise later failed with SIP 403. In reality the
     failed dial is a NEW call row for the same lead and phone (the original
     call ended successfully when the promise was made), so nothing matched and
     the real Villa del Sueño failure stayed marked "done".
   - This migration re-runs the backfill joining through lead_id + phone to the
     latest failed SIP-403 call that happened at/after the promised time.

2. Modified tables
   - `tourism_callbacks`: status done -> failed with the real fail_reason where
     a later SIP 403 call for the same lead+phone missed the promised window by
     no more than 15 minutes. promised_at stays untouched.

3. Security
   - No policy or grant changes.
*/
UPDATE public.tourism_callbacks cb
SET status = 'failed', fail_reason = c.error
FROM public.tourism_calls c
WHERE cb.status = 'done'
  AND cb.resolved_at IS NULL
  AND c.lead_id = cb.lead_id
  AND c.phone = cb.phone
  AND c.state = 'failed'
  AND c.error LIKE '%SIP 403%'
  AND c.finished_at >= cb.scheduled_for
  AND c.finished_at < cb.scheduled_for + interval '15 minutes'
  AND NOT EXISTS (
    SELECT 1 FROM public.tourism_callbacks other
    WHERE other.lead_id = cb.lead_id AND other.phone = cb.phone AND other.status = 'failed'
  );
