-- The verified agent reads back the row they just saved through the guarded function.
-- RLS still governs the read: only the draft's own prospect owner or an administrator.
CREATE POLICY "read_own_prospect_site_draft" ON public.prospect_site_drafts
  FOR SELECT TO authenticated
  USING (
    public.can_access_prospect(prospect_id)
    AND (created_by = public.current_staff_id() OR public.is_admin())
  );

GRANT SELECT ON public.prospect_site_drafts TO authenticated;
