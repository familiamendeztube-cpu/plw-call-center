import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeToken, toSavedSite } from '../../supabase/functions/plw-tourism-preview/rules.js';

// The preview endpoint's only job: turn a draft row into Kike's SavedSite with public
// fields only. These tests pin both the accepted token forms and what may never appear.

const TOKEN = 'a'.repeat(48);
const ROW = {
  site_slug: 'plw-tourism-tours',
  business_name: 'Tour Rincón',
  locale: 'La Fortuna',
  services: ['Tours guiados', 'Reservación en línea'],
  highlight: 'Puentes colgantes',
  booking_phone: '+506 8888-7777',
  description: 'Tours en lancha por el Río Frío.',
  facts: [{ label: 'Horario', value: '8 am-5 pm' }],
  faqs: [{ question: '¿Incluye almuerzo?', answer: 'Sí.' }],
  approved_images: [],
};

test('the token is the only key: 48 hex bytes, with or without the plw- URL prefix', () => {
  assert.equal(normalizeToken(TOKEN), TOKEN);
  assert.equal(normalizeToken(`plw-${TOKEN}`), TOKEN);
  assert.equal(normalizeToken('short'), null);
  assert.equal(normalizeToken(`${'g'.repeat(48)}`), null, 'hex only');
  assert.equal(normalizeToken(`${TOKEN}extra`), null);
  assert.equal(normalizeToken(''), null);
  assert.equal(normalizeToken(null), null);
});

test('the SavedSite shape carries exactly the public fields Kike renders', () => {
  const site = toSavedSite(ROW, 'draft-1');
  assert.deepEqual(site, {
    id: 'draft-1',
    slug: 'plw-tourism-tours',
    brand: {
      name: 'Tour Rincón',
      city: 'La Fortuna',
      phone: '+506 8888-7777',
      phoneHref: 'tel:+50688887777',
      email: '',
      address: '',
    },
    content: { es: {}, en: {} },
    photos: {},
    overrides: {
      tourismDemo: {
        services: ['Tours guiados', 'Reservación en línea'],
        highlight: 'Puentes colgantes',
        description: 'Tours en lancha por el Río Frío.',
        facts: [{ label: 'Horario', value: '8 am-5 pm' }],
        faqs: [{ question: '¿Incluye almuerzo?', answer: 'Sí.' }],
        approvedImages: [],
      },
    },
  });
});

test('only safe PLW storage URLs pass into approvedImages', () => {
  const site = toSavedSite(
    {
      ...ROW,
      approved_images: [
        { url: 'https://x.supabase.co/storage/v1/object/public/plw-site-images/approved/a1.webp', alt: 'Cabaña', kind: 'generated' },
        { url: 'https://evil.test/whatever', alt: 'Trampa', kind: 'business' },
        { url: 'https://x.supabase.co/storage/v1/object/public/plw-site-images/candidates/secret.jpg', alt: 'Privada', kind: 'business' },
        { url: 'https://x.supabase.co/storage/v1/object/public/plw-site-images/approved/b2.webp', alt: '', kind: 'business' },
        { url: 'https://x.supabase.co/storage/v1/object/public/plw-site-images/approved/c3.webp', alt: 'Ok', kind: 'otra' },
      ],
    },
    'd'
  );
  assert.deepEqual(site.overrides.tourismDemo.approvedImages, [
    {
      url: 'https://x.supabase.co/storage/v1/object/public/plw-site-images/approved/a1.webp',
      alt: 'Cabaña',
      kind: 'generated',
    },
  ]);
});

test('an unconfirmed or malformed booking phone is emitted as empty, not guessed', () => {
  assert.equal(toSavedSite({ ...ROW, booking_phone: 'nota teléfono' }, 'd').brand.phone, '');
  assert.equal(toSavedSite({ ...ROW, booking_phone: '' }, 'd').brand.phone, '');
  assert.equal(toSavedSite({ ...ROW, booking_phone: undefined }, 'd').brand.phone, '');
});

test('private data never reaches the response, even if a row ever carried it', () => {
  const dirty = toSavedSite(
    { ...ROW, contact_email: 'owner@plw.test', transcript: 'SECRETO', staff_id: 'agent-1' },
    'd'
  );
  const serialized = JSON.stringify(dirty);
  assert.ok(!serialized.includes('owner@plw.test'));
  assert.ok(!serialized.includes('SECRETO'));
  assert.ok(!serialized.includes('agent-1'));
  assert.equal(dirty.brand.email, '');
  assert.equal(dirty.brand.address, '');
});
