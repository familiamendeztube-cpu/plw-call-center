-- Recovered on 2026-11-19 from the live database (supabase_migrations.schema_migrations,
-- version 20261119034256). It was applied through Bolt but never committed; kept verbatim.
-- The public booking phone is optional: an empty one is a valid choice (no number on the page).
-- A typed number still must look like a real one and is gated by the approval checkbox in the UI.

CREATE OR REPLACE FUNCTION public.upsert_prospect_site_draft(
  p_prospect_id uuid,
  p_site_slug text,
  p_business_name text,
  p_locale text,
  p_category text,
  p_services text[],
  p_highlight text,
  p_booking_phone text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_staff text := public.current_staff_id();
  v_draft uuid;
  v_token text;
BEGIN
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  IF NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  IF p_site_slug NOT IN ('plw-tourism-tours', 'plw-tourism-stays') THEN
    RAISE EXCEPTION 'Sitio no disponible.';
  END IF;
  IF p_category NOT IN ('tours', 'lodging') THEN
    RAISE EXCEPTION 'Categoría no válida.';
  END IF;
  IF length(trim(p_business_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'El nombre del negocio es obligatorio.';
  END IF;
  -- Empty is allowed (no public phone); a typed number must be well formed.
  IF p_booking_phone <> '' AND p_booking_phone !~ '^\+?[0-9 ()-]{8,20}$' THEN
    RAISE EXCEPTION 'El teléfono de reservas debe ser un número válido confirmado por el cliente.';
  END IF;

  -- One row per prospect: an INSERT racing an INSERT loses cleanly and retries as an update.
  LOOP
    INSERT INTO public.prospect_site_drafts
      (prospect_id, site_slug, business_name, locale, category, services, highlight,
       booking_phone, preview_token, created_by)
    VALUES
      (p_prospect_id, p_site_slug, trim(p_business_name), coalesce(p_locale, ''), p_category,
       coalesce(p_services, '{}'), coalesce(p_highlight, ''), coalesce(p_booking_phone, ''),
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

GRANT EXECUTE ON FUNCTION public.upsert_prospect_site_draft(uuid, text, text, text, text, text[], text, text)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_prospect_site_draft(uuid, text, text, text, text, text[], text, text)
  FROM PUBLIC, anon;
