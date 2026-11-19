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

/**
 * Kike's SavedSite shape. Only the explicitly confirmed public booking phone is emitted;
 * there is no dedicated public email/address field yet, so those stay empty rather than
 * falling back to private data.
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
      },
    },
  };
}
