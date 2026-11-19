/*
# Business images for site drafts + preview voice rate-limit/cache

1. New storage bucket
- `plw-site-images` (private bucket). Objects under the `approved/` top-level folder
  are readable by anyone (anon + authenticated) because approved images appear on the
  public preview page. Objects under `candidates/` stay private: only authenticated
  staff with access to that prospect can read them.
2. Modified tables
- `prospect_site_drafts`: new column `approved_images` (jsonb, default '[]', max 4
  entries of {url, alt, kind}). Only URLs pointing at the approved/ folder of the
  plw-site-images bucket are accepted. Empty by default; nothing else changes.
3. New functions
- `set_prospect_site_approved_images(prospect_id, images)`: SECURITY DEFINER, validates
  the agent's session, prospect access, image shape (max 4, safe public storage URLs
  only, alt <= 200 chars, kind 'business'|'generated'), then saves the list. Used by the
  explicit "Usar imágenes seleccionadas" action.
4. New tables (server-only for the plw-tourism-voice function)
- `plw_voice_cache`: cache_key (sha256 of model|voice|language|text) -> mp3 audio
  (base64). Deduplicates repeated synthesis of the same grounded text.
- `plw_voice_rate`: per-key (token hash or IP hash) per-minute hit counters for rate
  limiting.
5. Security
- RLS enabled on both new tables with NO policies: they are server-only. All
  privileges revoked from anon/authenticated; service_role (edge functions) granted.
- Storage policies scoped to the plw-site-images bucket only; candidate paths validate
  prospect access with the existing can_access_prospect helper.
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('plw-site-images', 'plw-site-images', false)
ON CONFLICT (id) DO NOTHING;

-- Approved images are served on the public preview page.
CREATE POLICY "plw_site_images_public_approved_read" ON storage.objects
FOR SELECT TO anon, authenticated
USING (
  bucket_id = 'plw-site-images'
  AND (storage.foldername(name))[1] = 'approved'
);

-- Candidate material stays private to staff who can access the prospect.
CREATE POLICY "plw_site_images_agent_read" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'plw-site-images'
  AND (storage.foldername(name))[1] = 'candidates'
  AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.can_access_prospect(((storage.foldername(name))[2])::uuid)
);

CREATE POLICY "plw_site_images_agent_upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'plw-site-images'
  AND (storage.foldername(name))[1] IN ('approved', 'candidates')
  AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.can_access_prospect(((storage.foldername(name))[2])::uuid)
);

ALTER TABLE public.prospect_site_drafts
  ADD COLUMN IF NOT EXISTS approved_images jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(approved_images) = 'array' AND jsonb_array_length(approved_images) <= 4);

CREATE OR REPLACE FUNCTION public.set_prospect_site_approved_images(
  p_prospect_id uuid,
  p_images jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_staff text := public.current_staff_id();
  v_clean jsonb;
BEGIN
  IF v_staff IS NULL OR NOT public.can_access_prospect(p_prospect_id) THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;
  IF jsonb_typeof(p_images) <> 'array' OR jsonb_array_length(p_images) > 4 THEN
    RAISE EXCEPTION 'Las imágenes no son válidas.';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('url', f->>'url', 'alt', f->>'alt', 'kind', f->>'kind'))
  INTO v_clean
  FROM jsonb_array_elements(p_images) f
  WHERE jsonb_typeof(f) = 'object'
    AND f->>'url' ~ '^https://[^/]+/storage/v1/object/public/plw-site-images/approved/[A-Za-z0-9._-]+$'
    AND (f->>'url') NOT LIKE '%..%'
    AND length(f->>'alt') <= 200
    AND f->>'kind' IN ('business', 'generated');
  IF v_clean IS NULL THEN
    v_clean := '[]'::jsonb;
  END IF;
  IF jsonb_array_length(v_clean) <> jsonb_array_length(p_images) THEN
    RAISE EXCEPTION 'Las imágenes no son válidas.';
  END IF;

  UPDATE public.prospect_site_drafts
  SET approved_images = v_clean, updated_at = now()
  WHERE prospect_id = p_prospect_id;

  RETURN v_clean;
END $$;

REVOKE ALL ON FUNCTION public.set_prospect_site_approved_images(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_prospect_site_approved_images(uuid, jsonb)
  TO authenticated;

-- Server-only voice tables: no browser access at all.
CREATE TABLE IF NOT EXISTS public.plw_voice_cache (
  cache_key text PRIMARY KEY,
  audio_base64 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.plw_voice_rate (
  rate_key text NOT NULL,
  window_bucket text NOT NULL,
  hit_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (rate_key, window_bucket)
);

ALTER TABLE public.plw_voice_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plw_voice_rate ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.plw_voice_cache FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.plw_voice_rate FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.plw_voice_cache TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.plw_voice_rate TO service_role;
