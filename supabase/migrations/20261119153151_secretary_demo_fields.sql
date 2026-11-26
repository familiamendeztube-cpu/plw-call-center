/*
# Secretary IA demo fields on prospect site drafts

1. Purpose
   Adds an optional "Secretaria IA" (AI receptionist) voice-demo profile beside the
   existing sample-website draft. This is a voice sales demo only: no real phone dialing,
   no outbound sending, no activation of any assistant on a real line.

2. Modified table: `prospect_site_drafts`
   - `secretary_name` (text, optional, empty default): public business name spoken by the
     demo. Falls back to the draft's own `business_name` when empty.
   - `secretary_type` (text, optional, empty default): one of `tourism`, `restaurant`,
     `retail`, `services`. Falls back to the draft's `category` (tours→tourism,
     lodging→tourism, else services) when empty.
   Both are public marketing fields typed by the agent in the existing draft editor; no
   private, contact, or conversation data is ever involved.

3. Security
   - No RLS changes: the table already has its policies; the new columns ride the same
     row-level access (draft owner and admins).
   - Column-level UPDATE grant: the browser may set these two columns only, never the
     token, slug, or approval columns.
   - Legacy drafts (no secretary profile saved) keep working: the voice function treats
     the columns as optional and falls back to the existing name/category, and the same
     preview token continues to work unchanged.

4. Notes
   - No data is written in this migration; existing Bosque de Bruma draft is untouched.
   - Idempotent: re-running is safe (IF NOT EXISTS, conditional grant).
*/

ALTER TABLE public.prospect_site_drafts
  ADD COLUMN IF NOT EXISTS secretary_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS secretary_type text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_column_grants
    WHERE grantee = 'authenticated'
      AND table_name = 'prospect_site_drafts'
      AND column_name = 'secretary_name'
      AND privilege_type = 'UPDATE'
  ) THEN
    GRANT UPDATE (secretary_name, secretary_type) ON public.prospect_site_drafts TO authenticated;
  END IF;
END $$;
