import { getSupabaseClient } from '@/integrations/supabase/client';
import { readOptionalRow } from '@/production/adapters/productionRows';
import { draftFromRow, type ProspectSiteDraft, type SiteDraftInput } from '../models/siteDraft';

const SAVE_ERROR = 'No se pudo guardar el borrador del sitio.';

function columns(row: Record<string, unknown>) {
  return [
    'prospect_id',
    'site_slug',
    'business_name',
    'locale',
    'category',
    'services',
    'highlight',
    'booking_phone',
    'preview_token',
    'shared_at',
  ].map((key) => row[key]);
}

export function createProductionSiteDraftService() {
  const supabase = getSupabaseClient();

  return {
    async saveDraft(input: SiteDraftInput): Promise<ProspectSiteDraft> {
      const { data: draftId, error } = await supabase.rpc('upsert_prospect_site_draft', {
        p_prospect_id: input.prospectId,
        p_site_slug: input.siteSlug,
        p_business_name: input.businessName,
        p_locale: input.locale,
        p_category: input.category,
        p_services: input.services,
        p_highlight: input.highlight,
        p_booking_phone: input.bookingPhone,
      });
      if (error || typeof draftId !== 'string') throw new Error(error?.message || SAVE_ERROR);
      const { data, error: readError } = await supabase
        .from('prospect_site_drafts')
        .select(
          'prospect_id, site_slug, business_name, locale, category, services, highlight, booking_phone, preview_token, shared_at'
        )
        .eq('id', draftId)
        .maybeSingle();
      const row = readError ? null : readOptionalRow(data);
      if (!row) throw new Error(SAVE_ERROR);
      return draftFromRow(row as Record<string, unknown>);
    },

    async loadDraft(prospectId: string): Promise<ProspectSiteDraft | null> {
      const { data, error } = await supabase
        .from('prospect_site_drafts')
        .select(
          'prospect_id, site_slug, business_name, locale, category, services, highlight, booking_phone, preview_token, shared_at'
        )
        .eq('prospect_id', prospectId)
        .maybeSingle();
      if (error) throw new Error(SAVE_ERROR);
      const row = readOptionalRow(data);
      return row ? draftFromRow(row as Record<string, unknown>) : null;
    },

    async markShared(prospectId: string, channel: 'email' | 'whatsapp') {
      const { error } = await supabase.rpc('mark_prospect_site_shared', {
        p_prospect_id: prospectId,
        p_channel: channel,
      });
      if (error) throw new Error(error.message || SAVE_ERROR);
    },
  };
}

// Kept for parity with other adapters: the SELECT above runs under RLS-backed access already.
void columns;
