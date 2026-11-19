/*
# Website samples and Secretaria IA for every business type the agents sell to

Agents could only pick Tours or Hospedaje. Adds restaurant, clinic, shop, gym, real estate
and car shop/dealership ("auto"). Each category maps to its own Kike Sites template slug:
  tours        -> plw-tourism-tours
  lodging      -> plw-tourism-stays
  restaurant   -> plw-restaurant
  clinic       -> plw-clinic
  shop         -> plw-shop
  gym          -> plw-gym
  real_estate  -> plw-real-estate
  auto         -> plw-auto
The Secretaria IA demo gets the same business types.

Both functions are copied from their latest live definitions (20261119041110 and
20261119153504); only the allowed-value lists change. CREATE OR REPLACE keeps their grants.
*/

ALTER TABLE public.prospect_site_drafts DROP CONSTRAINT IF EXISTS prospect_site_drafts_site_slug_check;
ALTER TABLE public.prospect_site_drafts ADD CONSTRAINT prospect_site_drafts_site_slug_check
  CHECK (site_slug IN ('plw-tourism-tours', 'plw-tourism-stays', 'plw-restaurant', 'plw-clinic', 'plw-shop', 'plw-gym', 'plw-real-estate', 'plw-auto'));
ALTER TABLE public.prospect_site_drafts DROP CONSTRAINT IF EXISTS prospect_site_drafts_category_check;
ALTER TABLE public.prospect_site_drafts ADD CONSTRAINT prospect_site_drafts_category_check
  CHECK (category IN ('tours', 'lodging', 'restaurant', 'clinic', 'shop', 'gym', 'real_estate', 'auto'));

CREATE OR REPLACE FUNCTION public.upsert_prospect_site_draft(
  p_prospect_id uuid,
  p_site_slug text,
  p_business_name text,
  p_locale text,
  p_category text,
  p_services text[],
  p_highlight text,
  p_booking_phone text,
  p_description text DEFAULT NULL,
  p_facts jsonb DEFAULT NULL,
  p_faqs jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_staff text := public.current_staff_id();
  v_draft uuid;
  v_token text;
  v_description text := coalesce(p_description, '');
  v_facts jsonb := coalesce(p_facts, '[]'::jsonb);
  v_faqs jsonb := coalesce(p_faqs, '[]'::jsonb);
BEGIN
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  IF p_site_slug NOT IN ('plw-tourism-tours', 'plw-tourism-stays', 'plw-restaurant', 'plw-clinic', 'plw-shop', 'plw-gym', 'plw-real-estate', 'plw-auto') THEN
    RAISE EXCEPTION 'Sitio no disponible.';
  END IF;
  IF p_category NOT IN ('tours', 'lodging', 'restaurant', 'clinic', 'shop', 'gym', 'real_estate', 'auto') THEN
    RAISE EXCEPTION 'Categoría no válida.';
  END IF;
  IF length(trim(p_business_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'El nombre del negocio es obligatorio.';
  END IF;
  -- Empty is allowed (no public phone); a typed number must be well formed.
  IF p_booking_phone <> '' AND p_booking_phone !~ '^\+?[0-9 ()-]{8,20}$' THEN
    RAISE EXCEPTION 'El teléfono de reservas debe ser un número válido confirmado por el cliente.';
  END IF;
  IF length(v_description) > 2000 THEN
    RAISE EXCEPTION 'La descripción es demasiado larga.';
  END IF;
  IF jsonb_typeof(v_facts) <> 'array' OR jsonb_array_length(v_facts) > 12
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_facts) f
       WHERE jsonb_typeof(f->'label') <> 'string'
          OR jsonb_typeof(f->'value') <> 'string'
          OR length(f->>'label') NOT BETWEEN 1 AND 120
          OR length(f->>'value') NOT BETWEEN 1 AND 600
     ) THEN
    RAISE EXCEPTION 'Los datos del negocio no son válidos.';
  END IF;
  IF jsonb_typeof(v_faqs) <> 'array' OR jsonb_array_length(v_faqs) > 12
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_faqs) f
       WHERE jsonb_typeof(f->'question') <> 'string'
          OR jsonb_typeof(f->'answer') <> 'string'
          OR length(f->>'question') NOT BETWEEN 1 AND 300
          OR length(f->>'answer') NOT BETWEEN 1 AND 2000
     ) THEN
    RAISE EXCEPTION 'Las preguntas frecuentes no son válidas.';
  END IF;

  -- One row per prospect: an INSERT racing an INSERT loses cleanly and retries as an update.
  LOOP
    INSERT INTO public.prospect_site_drafts
      (prospect_id, site_slug, business_name, locale, category, services, highlight,
       booking_phone, description, facts, faqs, preview_token, created_by)
    VALUES
      (p_prospect_id, p_site_slug, trim(p_business_name), coalesce(p_locale, ''), p_category,
       coalesce(p_services, '{}'), coalesce(p_highlight, ''), coalesce(p_booking_phone, ''),
       v_description, v_facts, v_faqs,
       encode(extensions.gen_random_bytes(24), 'hex'), v_staff)
    ON CONFLICT (prospect_id) DO NOTHING
    RETURNING id INTO v_draft;
    EXIT WHEN v_draft IS NOT NULL;

    UPDATE public.prospect_site_drafts
    SET site_slug = p_site_slug,
        business_name = trim(p_business_name),
        locale = coalesce(p_locale, ''),
        category = p_category,
        services = coalesce(p_services, '{}'),
        highlight = coalesce(p_highlight, ''),
        booking_phone = coalesce(p_booking_phone, ''),
        description = v_description,
        facts = v_facts,
        faqs = v_faqs,
        updated_at = now()
    WHERE prospect_id = p_prospect_id
    RETURNING id, preview_token INTO v_draft, v_token;
    EXIT WHEN v_draft IS NOT NULL;
  END LOOP;

  IF v_token IS NULL THEN
    SELECT preview_token INTO v_token FROM public.prospect_site_drafts WHERE id = v_draft;
  END IF;
  RETURN v_draft;
END $$;

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
  IF v_type NOT IN ('tourism', 'restaurant', 'clinic', 'retail', 'gym', 'real_estate', 'auto', 'services') THEN
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
