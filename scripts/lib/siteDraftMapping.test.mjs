import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  draftFromRow,
  buildPreviewUrl,
  SITE_PREVIEW_BASE,
  parseImages,
  DRAFT_ROW_COLUMNS,
} from '../../src/features/site-draft/models/siteDraft.ts';

// Pins the row -> draft mapping the Secretaria IA section depends on: the preview token
// is read from the snake_case column (preview_token), not a camelCase field, so the demo
// links render on the secretary tab as soon as any website draft exists.

const TOKEN = 'a'.repeat(48);

const ROW = {
  prospect_id: 'p-1',
  site_slug: 'plw-tourism-tours',
  business_name: 'Bosque de Bruma Tours',
  locale: 'Heredia',
  category: 'tours',
  services: ['Caminata al volcán'],
  highlight: '',
  booking_phone: '',
  description: '',
  facts: [{ label: 'Horario', value: '8 am–5 pm' }],
  faqs: [{ question: '¿Hay estacionamiento?', answer: 'Sí.' }],
  approved_images: [{ url: 'https://meagbbmittuhdgwnhvxa.supabase.co/storage/v1/object/public/plw-site-images/approved/abc.webp', alt: 'Sendero', kind: 'generated' }],
  secretary_name: 'Bosque de Bruma Tours',
  secretary_type: 'tourism',
  preview_token: TOKEN,
  shared_at: null,
};

test('the preview token maps from the snake_case row column into the draft links', () => {
  const draft = draftFromRow(ROW);
  assert.equal(draft.previewToken, TOKEN, 'token comes from preview_token, not previewToken');
  assert.equal(draft.previewUrl, `${SITE_PREVIEW_BASE}/plw-${TOKEN}`);
  assert.equal(buildPreviewUrl(TOKEN), draft.previewUrl);
});

test('secretary demo URL is built from the same token as the website preview URL', () => {
  const draft = draftFromRow(ROW);
  const secretaryUrl = `${SITE_PREVIEW_BASE}/plw-${draft.previewToken}/secretaria`;
  assert.equal(secretaryUrl, `${SITE_PREVIEW_BASE}/plw-${TOKEN}/secretaria`);
  assert.ok(secretaryUrl.startsWith(draft.previewUrl.split('/plw-')[0]), 'same base as site link');
});

test('rows missing a token are rejected loudly instead of silently hiding the links', () => {
  assert.throws(() => draftFromRow({ ...ROW, preview_token: '' }), /vista previa/i);
  assert.throws(() => draftFromRow({ ...ROW, preview_token: undefined }), /vista previa/i);
});

test('approved images and secretary fields survive the mapping for the demo page', () => {
  const draft = draftFromRow(ROW);
  assert.equal(draft.secretaryName, 'Bosque de Bruma Tours');
  assert.equal(draft.secretaryType, 'tourism');
  assert.equal(parseImages(ROW.approved_images).length, 1);
  assert.match(DRAFT_ROW_COLUMNS, /preview_token/, 'the loader must select the token column');
  assert.match(DRAFT_ROW_COLUMNS, /secretary_name/, 'the loader must select the secretary fields');
});
