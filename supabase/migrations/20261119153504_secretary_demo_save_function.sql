/*
# Secretary IA save function

1. Purpose
   Lets the signed-in agent (or admin, for verification) save the two optional public
   Secretary IA fields on a prospect's site draft, reusing the exact same authorization
   as the existing upsert_prospect_site_draft function: current_staff_id() resolves the
   caller from the browser JWT, and can_access_prospect() enforces admin-or-owner access.

2. New function: `public.set_prospect_secretary_demo(text, text)`
   - Args: p_prospect_id uuid, p_name text, p_type text.
   - Validates: enabled staff, prospect access, name length 1-120, type in the fixed
     option list (tourism, restaurant, retail, services).
   - Creates the draft row if none exists yet (same fallbacks as the website card) so a
     secretary-only save still yields a working preview token.
   - Updates only the two secretary columns; never touches token, slug, approval, or
     images.

3. Security
   - SECURITY DEFINER, search_path pinned; EXECUTE granted to authenticated only.
   - No new tables, columns, or policies.

4. Notes
   - No data is written in this migration; nothing is dialed or sent. Pure persistence.
*/

CREATE OR REPLACE FUNCTION public.set_prospect_secretary_demo(
  p_prospect_id uuid,
  p_name text,
  p_type text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_staff text := public.current_staff_id();
  v_draft record;
  v_name text := trim(coalesce(p_name, ''));
  v_type text := coalesce(p_type, 'services');
BEGIN
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  IF length(v_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'El nombre del negocio es obligatorio.';
  END IF;
  IF v_type NOT IN ('tourism', 'restaurant', 'retail', 'services') THEN
    RAISE EXCEPTION 'El tipo de negocio no es válido.';
  END IF;

  SELECT id, preview_token INTO v_draft
  FROM public.prospect_site_drafts
  WHERE prospect_id = p_prospect_id;

  IF NOT FOUND THEN
    -- Same minimal draft as the website card's first save, so the secretary demo has a
    -- token even if the agent never opened the website tab.
    INSERT INTO public.prospect_site_drafts
      (prospect_id, site_slug, business_name, locale, category,
       services, highlight, booking_phone, description, facts, faqs,
       secretary_name, secretary_type, preview_token, created_by)
    VALUES
      (p_prospect_id, 'plw-tourism-tours', v_name, '', 'tours',
       '{}', '', '', '', '[]'::jsonb, '[]'::jsonb,
       v_name, v_type,
       encode(extensions.gen_random_bytes(24), 'hex'), v_staff)
    RETURNING id INTO v_draft;
  ELSE
    UPDATE public.prospect_site_drafts
    SET secretary_name = v_name,
        secretary_type = v_type,
        updated_at = now()
    WHERE prospect_id = p_prospect_id;
  END IF;

  RETURN v_draft.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_prospect_secretary_demo(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_prospect_secretary_demo(uuid, text, text) TO authenticated;
