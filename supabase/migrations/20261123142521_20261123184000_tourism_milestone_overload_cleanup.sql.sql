/*
# Drop the old 3-arg milestone overload and grant service_role read access

1. Plain-English
   - `add_tourism_milestone` now takes an optional agreed slot (4 args). The
     previous 3-argument version was left in place, which made every 3-arg call
     ambiguous ("function is not unique"). This removes the old overload; the
     4-arg version has defaults, so existing callers keep working.
   - The dialer runner (service role) reads milestone rows directly in one sync
     path, so it needs an explicit SELECT grant (RLS still applies; service
     role bypasses it).

2. Modified objects
   - DROP FUNCTION public.add_tourism_milestone(uuid, text, text)
   - GRANT SELECT ON public.tourism_milestones TO service_role

3. Security
   - No policy changes; the RPCs remain the only writable path for staff.
*/
DROP FUNCTION IF EXISTS public.add_tourism_milestone(uuid, text, text);
GRANT SELECT ON public.tourism_milestones TO service_role;
