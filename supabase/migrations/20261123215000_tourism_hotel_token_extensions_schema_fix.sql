/*
# Fix: token generation must qualify the extensions schema

1. Why
   `ensure_tourism_hotel_demo_link` and `rotate_tourism_hotel_demo_token` call
   `gen_random_bytes(...)`, which on Supabase lives in the `extensions` schema. Their
   pinned `search_path = public, pg_temp` does not include it, so generating or rotating
   a hotel demo link failed at runtime ("function gen_random_bytes(integer) does not
   exist"). Qualified calls (`extensions.gen_random_bytes`) work from any search_path.

2. Changes
   - Both functions now use `extensions.gen_random_bytes(24)`. Behavior is otherwise
     identical to the previous fixed versions (preview_token + created_by on the
     auto-created draft, access checks unchanged).

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
  VALUES (p_prospect_id, encode(extensions.gen_random_bytes(24), 'hex'), v_staff, '')
  ON CONFLICT (prospect_id) DO UPDATE SET prospect_id = EXCLUDED.prospect_id
  RETURNING * INTO v_link;
  RETURN v_link;
END $$;

CREATE OR REPLACE FUNCTION public.rotate_tourism_hotel_demo_token(p_prospect_id uuid)
RETURNS public.tourism_hotel_demo_links
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_link public.tourism_hotel_demo_links;
BEGIN
  SELECT * INTO v_link FROM public.tourism_hotel_demo_links WHERE prospect_id = p_prospect_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El enlace todavía no existe.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'Solo el agente asignado o administración.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tourism_hotel_demo_links
  SET token = encode(extensions.gen_random_bytes(24), 'hex'), revoked_at = NULL
  WHERE id = v_link.id
  RETURNING * INTO v_link;
  RETURN v_link;
END $$;

REVOKE ALL ON FUNCTION public.ensure_tourism_hotel_demo_link(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rotate_tourism_hotel_demo_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_tourism_hotel_demo_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_tourism_hotel_demo_token(uuid) TO authenticated;
