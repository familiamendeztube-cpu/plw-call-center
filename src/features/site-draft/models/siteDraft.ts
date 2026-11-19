/** A prospect's sample website draft: created once, then reopened and updated in place. */
export interface ProspectSiteDraft {
  prospectId: string;
  siteSlug: 'plw-tourism-tours' | 'plw-tourism-stays';
  businessName: string;
  locale: string;
  category: 'tours' | 'lodging';
  services: string[];
  highlight: string;
  /** Public booking phone the customer explicitly confirmed for the page. */
  bookingPhone: string;
  previewUrl: string;
  sharedAt: string | null;
}

export const SITE_PREVIEW_BASE = 'https://familiamendeztube-cp-q9tc.bolt.host/preview';

export const SITE_SLUGS = {
  tours: 'plw-tourism-tours',
  lodging: 'plw-tourism-stays',
} as const;

export function buildPreviewUrl(token: string): string {
  // The plw- prefix is URL-only; the API and Kike both accept the token without it.
  return `${SITE_PREVIEW_BASE}/plw-${token}`;
}

/** Readable defaults an agent edits instead of typing from zero. */
export function suggestServices(category: 'tours' | 'lodging', interest: string): string[] {
  const base =
    category === 'tours'
      ? ['Tours guiados', 'Reservación en línea']
      : ['Habitaciones privadas', 'Reservación en línea'];
  return interest.trim() ? [...base, interest.trim().slice(0, 80)] : base;
}

export function draftFromRow(row: Record<string, unknown>): ProspectSiteDraft {
  const token = row['preview_token'];
  if (typeof token !== 'string' || !token) {
    throw new Error('Fila inválida: falta el enlace de vista previa.');
  }
  const category = row['category'];
  const services = row['services'];
  return {
    prospectId: row['prospect_id'] as string,
    siteSlug: row['site_slug'] === 'plw-tourism-stays' ? 'plw-tourism-stays' : 'plw-tourism-tours',
    businessName: row['business_name'] as string,
    locale: (row['locale'] as string) ?? '',
    category: category === 'lodging' ? 'lodging' : 'tours',
    services: Array.isArray(services) ? services.map(String) : [],
    highlight: (row['highlight'] as string) ?? '',
    bookingPhone: (row['booking_phone'] as string) ?? '',
    previewUrl: buildPreviewUrl(token),
    sharedAt: (row['shared_at'] as string | null) ?? null,
  };
}

export interface SiteDraftInput {
  prospectId: string;
  siteSlug: 'plw-tourism-tours' | 'plw-tourism-stays';
  businessName: string;
  locale: string;
  category: 'tours' | 'lodging';
  services: string[];
  highlight: string;
  bookingPhone: string;
}

/** Creates the draft on first save, then reopens and updates the same one. */
export interface SiteDraftService {
  saveDraft(input: SiteDraftInput): Promise<ProspectSiteDraft>;
  loadDraft(prospectId: string): Promise<ProspectSiteDraft | null>;
  markShared(prospectId: string, channel: 'email' | 'whatsapp'): Promise<void>;
}
