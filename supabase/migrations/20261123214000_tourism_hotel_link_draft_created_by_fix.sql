/*
# Fix: the auto-created site draft also needs created_by

1. Why
   Follow-up to the preview_token fix: `prospect_site_drafts.created_by` is NOT NULL
   (who saved the draft), and the minimal draft created by
   `ensure_tourism_hotel_demo_link` omitted it, so link creation still failed for
   hotels without a draft.

2. Changes
   - `ensure_tourism_hotel_demo_link(uuid)`: the auto-created draft records the
     staff member creating the link as `created_by` (the function already verified
     the caller is the assigned agent or an admin). Nothing else changes.

3. Security
   - Same grants: EXECUTE to authenticated only.
*/
CREATE OR REPLACE FUNCTION public.ensure_tourism_hotel_demo_link(p_prospect_id uuid)
RETURNS public.tourism_hotel_demo_links
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_staff text := public.current_staff_id();
  v_link public.tourism_hotel_demo_links;
BEGIN
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'Solo el personal puede generar el enlace.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'Solo el agente asignado o administración.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.prospect_site_drafts
    (prospect_id, site_slug, business_name, locale, category, preview_token, created_by)
  SELECT p_prospect_id, 'plw-tourism-stays', p.business_name, '', 'lodging',
         encode(extensions.gen_random_bytes(24), 'hex'), v_staff
  FROM public.prospects p
  WHERE p.id = p_prospect_id
  ON CONFLICT (prospect_id) DO NOTHING;

  INSERT INTO public.tourism_hotel_demo_links (prospect_id, token, created_by, note)
  VALUES (p_prospect_id, encode(gen_random_bytes(24), 'hex'), v_staff, '')
  ON CONFLICT (prospect_id) DO UPDATE SET prospect_id = EXCLUDED.prospect_id
  RETURNING * INTO v_link;
  RETURN v_link;
END $$;

REVOKE ALL ON FUNCTION public.ensure_tourism_hotel_demo_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_tourism_hotel_demo_link(uuid) TO authenticated;
