-- Recovered on 2026-11-19 from the live database (supabase_migrations.schema_migrations,
-- version 20261119034322). It was applied through Bolt but never committed; kept verbatim.
-- Empty means "no public phone on the page": a valid, deliberate choice.
ALTER TABLE public.prospect_site_drafts
  DROP CONSTRAINT prospect_site_drafts_booking_phone_check;
ALTER TABLE public.prospect_site_drafts
  ADD CONSTRAINT prospect_site_drafts_booking_phone_check
  CHECK (booking_phone ~ '^\+?[0-9 ()-]{8,20}$' OR booking_phone = '');
