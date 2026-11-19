/*
# Site drafts and public voice: permission and housekeeping fixes (review 2026-11-19)

1. mark_prospect_site_shared now checks can_access_prospect (admin or the customer's owner).
   Before, any signed-in staff member could mark any customer's preview as shared.
2. Draft read policy follows can_access_prospect only. It also required created_by = the
   caller, so a reassigned customer's new agent could overwrite the draft (the save function
   uses can_access_prospect) but not see it.
3. The column UPDATE grant on secretary_name/secretary_type is revoked: browsers write
   through set_prospect_secretary_demo only. The table has no UPDATE policy, so the grant
   did nothing except contradict the "browsers read, functions write" rule.
4. Hourly cleanup of the public voice tables: rate-limit rows older than an hour, cached
   audio older than 30 days (re-synthesized on demand). Both grew without bound.
5. plw_site_image_candidates: no browser access. Only the plw-site-images function (service
   role) uses it. The direct INSERT/UPDATE grants let an agent register a candidate row for
   their own customer pointing at another customer's private storage path, which "approve"
   then copied into the public bucket.
*/

REVOKE ALL ON public.plw_site_image_candidates FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_prospect_site_shared(
  p_prospect_id uuid,
  p_channel text
) RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_staff text := public.current_staff_id();
  v_at timestamptz;
BEGIN
  IF v_staff IS NULL OR NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  IF p_channel NOT IN ('email', 'whatsapp') THEN
    RAISE EXCEPTION 'Canal no válido.';
  END IF;
  UPDATE public.prospect_site_drafts
  SET shared_at = now(), updated_at = now()
  WHERE prospect_id = p_prospect_id
  RETURNING shared_at INTO v_at;
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'No hay borrador de sitio para este cliente.';
  END IF;
  RETURN v_at;
END $$;
REVOKE ALL ON FUNCTION public.mark_prospect_site_shared(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_prospect_site_shared(uuid, text) TO authenticated;

DROP POLICY IF EXISTS "read_own_prospect_site_draft" ON public.prospect_site_drafts;
CREATE POLICY "read_own_prospect_site_draft" ON public.prospect_site_drafts
  FOR SELECT TO authenticated
  USING (public.can_access_prospect(prospect_id));

REVOKE UPDATE (secretary_name, secretary_type) ON public.prospect_site_drafts FROM authenticated;

-- window_bucket is the UTC minute as text ('YYYY-MM-DDTHH:MI'), so text order is time order.
SELECT cron.schedule('plw-voice-cleanup', '17 * * * *', $job$
  DELETE FROM public.plw_voice_rate
  WHERE window_bucket < to_char((now() AT TIME ZONE 'UTC') - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI');
  DELETE FROM public.plw_voice_cache WHERE created_at < now() - interval '30 days';
$job$);
