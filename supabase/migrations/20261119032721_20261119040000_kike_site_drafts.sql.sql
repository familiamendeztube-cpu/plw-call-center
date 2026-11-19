-- Kike Sites draft for a prospect: agent creates one sample-site draft per prospect with a
-- shareable preview link. Draft only: no publish, no automatic sending. The Kike Sites project
-- (SavedSite, slug, overrides.tourismDemo) reads the same shape when its integration lands.

CREATE TABLE IF NOT EXISTS public.prospect_site_drafts (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  site_slug text NOT NULL CHECK (site_slug IN ('plw-tourism-tours', 'plw-tourism-stays')),
  business_name text NOT NULL CHECK (length(trim(business_name)) BETWEEN 1 AND 120),
  locale text NOT NULL DEFAULT '' CHECK (length(locale) <= 120),
  category text NOT NULL CHECK (category IN ('tours', 'lodging')),
  services text[] NOT NULL DEFAULT '{}' CHECK (cardinality(services) <= 12),
  highlight text NOT NULL DEFAULT '' CHECK (length(highlight) <= 400),
  booking_phone text NOT NULL DEFAULT '' CHECK (booking_phone ~ '^\+?[0-9 ()-]{8,20}$'),
  preview_token text NOT NULL,
  kike_site_id text,
  shared_at timestamptz,
  created_by text NOT NULL REFERENCES public.staff_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prospect_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS prospect_site_drafts_token_key
  ON public.prospect_site_drafts (preview_token);

ALTER TABLE public.prospect_site_drafts ENABLE ROW LEVEL SECURITY;

-- No browser reads or writes directly: every path goes through the guarded functions.
REVOKE ALL ON public.prospect_site_drafts FROM anon, authenticated;

GRANT SELECT ON public.prospect_site_drafts TO service_role;
