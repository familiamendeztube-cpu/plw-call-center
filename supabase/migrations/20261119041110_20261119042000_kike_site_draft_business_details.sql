-- Recovered on 2026-11-19 from the live database (supabase_migrations.schema_migrations,
-- version 20261119041110). It was applied through Bolt but never committed; kept verbatim.
-- Optional "Mejorar la muestra" details, all owner-typed (confirmed public): a description,
-- label/value facts, and question/answer FAQs. They extend the preview under tourismDemo;
-- nothing here is sourced from CRM internals. Empty is the default.

ALTER TABLE public.prospect_site_drafts
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT ''
    CHECK (length(description) <= 2000),
  ADD COLUMN IF NOT EXISTS facts jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(facts) = 'array'),
  ADD COLUMN IF NOT EXISTS faqs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(faqs) = 'array');

-- Extended save: three optional parameters at the end, so existing callers keep working.
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

-- Replace the earlier 8-argument version so exactly one guarded entry point remains.
DROP FUNCTION IF EXISTS public.upsert_prospect_site_draft(uuid, text, text, text, text, text[], text, text);

REVOKE ALL ON FUNCTION public.upsert_prospect_site_draft(uuid, text, text, text, text, text[], text, text, text, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_prospect_site_draft(uuid, text, text, text, text, text[], text, text, text, jsonb, jsonb)
  TO authenticated;
