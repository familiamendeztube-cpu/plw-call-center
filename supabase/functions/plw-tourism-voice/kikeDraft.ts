// Kike Code previews: a site an agent builds in Kike Code (PLW's main project) gets the same
// Secretaria IA demo as a Call Center sample. Its preview link carries a 64-hex token, which the
// demo sends as "kike-<token>"; the business is read from Kike's public preview endpoint (the
// unlisted, read-only draft the preview page itself shows). Nothing about it is stored here
// except the demo sessions. Kept as identical copies in plw-secretary-converse and
// plw-tourism-voice (each function deploys only its own folder; scripts/lib checks they match).

export const KIKE_TOKEN = /^kike-[0-9a-f]{64}$/;

const KIKE_SITES_URL = 'https://gmtqevyjtflqpxxcrnpp.supabase.co/functions/v1/kike-sites';

// Kike template slugs -> the Secretaria's business types (demoAgent TYPE_LABELS); else services.
const KIKE_TYPES: [RegExp, string][] = [
  [/restaurant|bakery|catering/, 'restaurant'],
  [/(^|-)auto(-|$)|-garage$/, 'auto'],
  [/clinic/, 'clinic'],
  [/shop|suplidora/, 'retail'],
  [/gym/, 'gym'],
  [/real-estate/, 'real_estate'],
  [/tourism/, 'tourism'],
];

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const items = (section: unknown): Json[] => {
  const list = obj(section).items;
  return Array.isArray(list) ? list.map(obj) : [];
};

/** A Kike draft (kike-sites ?preview=) as the Secretaria reads a prospect_site_drafts row. */
export function draftFromKikeSite(site: unknown) {
  const saved = obj(site);
  const brand = obj(saved.brand);
  const es = obj(obj(saved.content).es);
  const hero = obj(es.hero);
  const name = text(brand.name);
  const slug = text(saved.slug);
  return {
    business_name: name,
    locale: text(brand.city),
    category: null,
    services: items(es.services).map((item) => text(item.title)).filter(Boolean),
    highlight: [text(hero.title1), text(hero.title2)].filter(Boolean).join(' '),
    description: text(hero.subtitle),
    faqs: items(es.faq)
      .map((item) => ({ question: text(item.q), answer: text(item.a) }))
      .filter((faq) => faq.question && faq.answer),
    // Like a Call Center sample, the demo never reads out contact numbers: place and hours only.
    facts: [
      ['Dirección', brand.address],
      ['Horario', obj(es.footer).hours],
    ]
      .map(([label, value]) => ({ label: label as string, value: text(value) }))
      .filter((fact) => fact.value),
    // The draft's own name and type speak for the Secretaria: Kike has no separate profile.
    secretary_name: name,
    secretary_type: KIKE_TYPES.find(([pattern]) => pattern.test(slug))?.[1] ?? 'services',
  };
}

/** The draft behind a "kike-<token>" preview: data null when Kike has no such preview (or it is off). */
export async function fetchKikeDraft(
  token: string
): Promise<{ data: ReturnType<typeof draftFromKikeSite> | null; error: string | null }> {
  const res = await fetch(`${KIKE_SITES_URL}?preview=${token.slice('kike-'.length)}`, {
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (res?.status === 404 || res?.status === 410) return { data: null, error: null };
  if (!res?.ok) return { data: null, error: `kike-sites ${res?.status ?? 'unreachable'}` };
  const site = await res.json().catch(() => null);
  return site ? { data: draftFromKikeSite(site), error: null } : { data: null, error: 'kike-sites bad json' };
}
