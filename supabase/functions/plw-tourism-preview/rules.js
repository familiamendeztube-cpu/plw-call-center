// Pure mapping and validation for plw-tourism-preview, shared with the node tests.
// This file is the security boundary for what a preview token may reveal: only public
// marketing fields, never prospect identity, contact data beyond the confirmed phone,
// conversations, notes, or staff information.

// 24 random bytes, hex-encoded: the same format the draft creator writes.
const TOKEN = /^[0-9a-f]{48}$/;
const PHONE = /^\+?[0-9 ()-]{8,20}$/;

/** Accepts Kike's link form (plw-<token>) and the bare token; rejects anything else. */
export function normalizeToken(raw) {
  if (typeof raw !== 'string') return null;
  const token = raw.startsWith('plw-') ? raw.slice(4) : raw;
  return TOKEN.test(token) ? token : null;
}

function cleanPairs(raw, keyA, keyB, max) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const a = item?.[keyA];
      const b = item?.[keyB];
      return typeof a === 'string' && typeof b === 'string'
        ? { [keyA]: a.trim().slice(0, max), [keyB]: b.trim().slice(0, max * 4) }
        : null;
    })
    .filter((pair) => pair !== null && pair[keyA] !== '' && pair[keyB] !== '');
}

/**
 * Kike's SavedSite shape. Only the explicitly confirmed public booking phone is emitted;
 * there is no dedicated public email/address field yet, so those stay empty rather than
 * falling back to private data. description/facts/faqs are the owner-confirmed
 * "Mejorar la muestra" details and ride along under tourismDemo.
 */
export function toSavedSite(row, draftId) {
  const phone = PHONE.test(row.booking_phone ?? '') ? row.booking_phone : '';
  const services = Array.isArray(row.services)
    ? row.services.filter((service) => typeof service === 'string' && service.trim() !== '').slice(0, 12)
    : [];
  return {
    id: draftId,
    slug: row.site_slug,
    brand: {
      name: row.business_name,
      city: row.locale ?? '',
      phone,
      phoneHref: phone ? `tel:${phone.replace(/[^+0-9]/g, '')}` : '',
      email: '',
      address: '',
    },
    content: { es: {}, en: {} },
    photos: {},
    overrides: {
      tourismDemo: {
        services,
        highlight: row.highlight ?? '',
        description: typeof row.description === 'string' ? row.description : '',
        facts: cleanPairs(row.facts, 'label', 'value', 120),
        faqs: cleanPairs(row.faqs, 'question', 'answer', 300),
      },
    },
  };
}
