/*
# Site images: public approved bucket + private candidate bucket + candidate registry

1. Storage buckets
- `plw-site-images` becomes a PUBLIC bucket used ONLY for approved images under
  approved/. A public bucket serves every object at /object/public/, so path-based
  policies cannot truly hide anything in it — therefore it must never hold candidates.
  It has no INSERT/UPDATE/DELETE policies: nobody uploads to it directly from a
  browser; only the plw-site-images edge function (service role) writes approved files.
- New `plw-site-candidates` PRIVATE bucket: staged candidate images, reachable only
  through short-lived signed URLs created by the edge function. Policies let
  authenticated staff with access to the prospect read/upload objects under
  {prospect_uuid}/ only.
- Old path-scoped policies from the previous migration are dropped.
2. New table
- `plw_site_image_candidates`: staged candidate registry.
  - id (uuid), prospect_id (uuid, FK prospects, cascade), storage_path (text),
  - kind ('business' = photo authorized by the owner, 'generated' = AI illustrative),
  - authorized (boolean, set only by the agent's explicit per-image approval),
  - alt (text), created_at.
3. Security
- RLS enabled on plw_site_image_candidates; separate SELECT/INSERT/UPDATE/DELETE
  policies for authenticated, each requiring public.can_access_prospect(prospect_id).
- Service_role granted full access for the edge function.
- No anon access to candidates anywhere.
*/

UPDATE storage.buckets SET public = true WHERE id = 'plw-site-images';

DROP POLICY IF EXISTS "plw_site_images_public_approved_read" ON storage.objects;
DROP POLICY IF EXISTS "plw_site_images_agent_read" ON storage.objects;
DROP POLICY IF EXISTS "plw_site_images_agent_upload" ON storage.objects;

INSERT INTO storage.buckets (id, name, public)
VALUES ('plw-site-candidates', 'plw-site-candidates', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "plw_site_candidates_agent_read" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'plw-site-candidates'
  AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.can_access_prospect(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "plw_site_candidates_agent_upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'plw-site-candidates'
  AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.can_access_prospect(((storage.foldername(name))[1])::uuid)
);

CREATE TABLE IF NOT EXISTS public.plw_site_image_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('business', 'generated')),
  authorized boolean NOT NULL DEFAULT false,
  alt text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plw_site_image_candidates ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plw_site_image_candidates TO authenticated;
GRANT ALL ON public.plw_site_image_candidates TO service_role;

DROP POLICY IF EXISTS "candidates_select_own_prospect" ON public.plw_site_image_candidates;
DROP POLICY IF EXISTS "candidates_insert_own_prospect" ON public.plw_site_image_candidates;
DROP POLICY IF EXISTS "candidates_update_own_prospect" ON public.plw_site_image_candidates;
DROP POLICY IF EXISTS "candidates_delete_own_prospect" ON public.plw_site_image_candidates;

CREATE POLICY "candidates_select_own_prospect" ON public.plw_site_image_candidates
FOR SELECT TO authenticated
USING (public.can_access_prospect(prospect_id));

CREATE POLICY "candidates_insert_own_prospect" ON public.plw_site_image_candidates
FOR INSERT TO authenticated
WITH CHECK (public.can_access_prospect(prospect_id));

CREATE POLICY "candidates_update_own_prospect" ON public.plw_site_image_candidates
FOR UPDATE TO authenticated
USING (public.can_access_prospect(prospect_id))
WITH CHECK (public.can_access_prospect(prospect_id));

CREATE POLICY "candidates_delete_own_prospect" ON public.plw_site_image_candidates
FOR DELETE TO authenticated
USING (public.can_access_prospect(prospect_id));
