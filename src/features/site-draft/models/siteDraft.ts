/** A prospect's sample website draft: created once, then reopened and updated in place. */
export interface SiteDraftFact {
  label: string;
  value: string;
}

export interface SiteDraftFaq {
  question: string;
  answer: string;
}

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
  /** Optional "Mejorar la muestra" details, each typed by the agent from the owner's words. */
  description: string;
  facts: SiteDraftFact[];
  faqs: SiteDraftFaq[];
  approvedImages: SiteDraftImage[];
  /** Optional Secretary IA demo profile; falls back to the draft name/category. */
  secretaryName: string;
  secretaryType: string;
  previewUrl: string;
  previewToken: string;
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
    description: (row['description'] as string) ?? '',
    facts: parsePairs(row['facts']),
    faqs: parseFaqs(row['faqs']),
    approvedImages: parseImages(row['approved_images']),
    secretaryName: (row['secretary_name'] as string) ?? '',
    secretaryType: (row['secretary_type'] as string) ?? '',
    previewUrl: buildPreviewUrl(token),
    previewToken: token,
    sharedAt: (row['shared_at'] as string | null) ?? null,
  };
}

function parsePairs(raw: unknown): SiteDraftFact[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const label = (item as Record<string, unknown> | null)?.['label'];
    const value = (item as Record<string, unknown> | null)?.['value'];
    return typeof label === 'string' && typeof value === 'string' ? [{ label, value }] : [];
  });
}

function parseFaqs(raw: unknown): SiteDraftFaq[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const question = (item as Record<string, unknown> | null)?.['question'];
    const answer = (item as Record<string, unknown> | null)?.['answer'];
    return typeof question === 'string' && typeof answer === 'string' ? [{ question, answer }] : [];
  });
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
  description: string;
  facts: SiteDraftFact[];
  faqs: SiteDraftFaq[];
  approvedImages: SiteDraftImage[];
}

/** Creates the draft on first save, then reopens and updates the same one. */
export interface SiteDraftService {
  saveDraft(input: SiteDraftInput): Promise<ProspectSiteDraft>;
  loadDraft(prospectId: string): Promise<ProspectSiteDraft | null>;
  markShared(prospectId: string, channel: 'email' | 'whatsapp'): Promise<void>;
}

export const DRAFT_ROW_COLUMNS =
  'prospect_id, site_slug, business_name, locale, category, services, highlight, booking_phone, description, facts, faqs, approved_images, secretary_name, secretary_type, preview_token, shared_at';

export interface SiteDraftImage {
  url: string;
  alt: string;
  kind: 'generated' | 'business';
}

export function parseImages(raw: unknown): SiteDraftImage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const url = (item as Record<string, unknown> | null)?.['url'];
    const alt = (item as Record<string, unknown> | null)?.['alt'];
    const kind = (item as Record<string, unknown> | null)?.['kind'];
    return typeof url === 'string' && typeof alt === 'string' && (kind === 'generated' || kind === 'business')
      ? [{ url, alt, kind }]
      : [];
  });
}

/** Public search entry points an agent opens and verifies manually; nothing is crawled. */
export function buildBusinessSearchUrl(name: string, place: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${name} ${place}`.trim())}`;
}

export function buildMapsSearchUrl(name: string, place: string): string {
  return `https://www.google.com/maps/search/${encodeURIComponent(`${name} ${place}`.trim())}`;
}
