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
  siteSlug: SiteSlug;
  businessName: string;
  locale: string;
  category: SiteCategory;
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

/**
 * Business types an agent can build a sample for: the database category, the label agents
 * see, the Kike Sites template slug, and the matching Secretaria IA type. Same lists as
 * migration 20261119220000.
 */
export const SITE_TYPES = [
  { category: 'tours', label: 'Tours', slug: 'plw-tourism-tours', secretary: 'tourism' },
  { category: 'lodging', label: 'Hospedaje', slug: 'plw-tourism-stays', secretary: 'tourism' },
  { category: 'restaurant', label: 'Restaurante', slug: 'plw-restaurant', secretary: 'restaurant' },
  { category: 'clinic', label: 'Clínica', slug: 'plw-clinic', secretary: 'clinic' },
  { category: 'shop', label: 'Tienda', slug: 'plw-shop', secretary: 'retail' },
  { category: 'gym', label: 'Gimnasio', slug: 'plw-gym', secretary: 'gym' },
  { category: 'real_estate', label: 'Bienes raíces', slug: 'plw-real-estate', secretary: 'real_estate' },
  { category: 'auto', label: 'Taller o agencia de autos', slug: 'plw-auto', secretary: 'auto' },
] as const;

export type SiteCategory = (typeof SITE_TYPES)[number]['category'];
export type SiteSlug = (typeof SITE_TYPES)[number]['slug'];
export type SecretaryType = (typeof SITE_TYPES)[number]['secretary'] | 'services';

const siteType = (category: unknown) => SITE_TYPES.find((type) => type.category === category);
export const slugFor = (category: SiteCategory): SiteSlug => siteType(category)?.slug ?? 'plw-tourism-tours';

// The customer's category is free text ("Taller mecánico", "Clínica dental", "Hotel"...).
// First match wins; accents are removed before matching.
const GUESSES: [RegExp, SiteCategory][] = [
  [/\b(hosped|hotel|cabin|alojam|hostal|lodge)/, 'lodging'],
  [/\b(tour|turis|viaje)/, 'tours'],
  [/\b(restaur|soda|cafeter|pizz|comida|marisquer)/, 'restaurant'],
  [/\b(clinic|dental|dentist|odonto|medic|consultorio|veterinar|salud)/, 'clinic'],
  [/\b(gimnas|gym|fitness|crossfit)/, 'gym'],
  [/\b(inmobil|bienes raices|real estate|propiedad)/, 'real_estate'],
  [/\b(taller|mecanic|automotr|autos?\b|carros?\b|vehicul|concesionari|dealer)/, 'auto'],
  [/\b(tienda|shop|boutique|ferreter|almacen|venta|super)/, 'shop'],
];

export function guessSiteCategory(businessCategory: string): SiteCategory | null {
  const text = businessCategory.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return GUESSES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** Secretaria IA type for a customer: from the guessed site type, else general services. */
export function guessSecretaryType(businessCategory: string): SecretaryType {
  return siteType(guessSiteCategory(businessCategory))?.secretary ?? 'services';
}

export function buildPreviewUrl(token: string): string {
  // The plw- prefix is URL-only; the API and Kike both accept the token without it.
  return `${SITE_PREVIEW_BASE}/plw-${token}`;
}

export function draftFromRow(row: Record<string, unknown>): ProspectSiteDraft {
  const token = row['preview_token'];
  if (typeof token !== 'string' || !token) {
    throw new Error('Fila inválida: falta el enlace de vista previa.');
  }
  const type = siteType(row['category']) ?? SITE_TYPES[0];
  const services = row['services'];
  return {
    prospectId: row['prospect_id'] as string,
    siteSlug: type.slug,
    businessName: row['business_name'] as string,
    locale: (row['locale'] as string) ?? '',
    category: type.category,
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
  siteSlug: SiteSlug;
  businessName: string;
  locale: string;
  category: SiteCategory;
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
