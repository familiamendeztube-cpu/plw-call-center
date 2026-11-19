import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectImageType,
  approvedObjectName,
  isUuid,
} from '../../supabase/functions/plw-site-images/rules.ts';
import {
  normalizeToken,
  parseVoiceRequest,
} from '../../supabase/functions/plw-tourism-voice/rules.ts';
import {
  buildAnswer,
  isAnswerId,
} from '../../supabase/functions/plw-tourism-voice/grounding.ts';

// Pins the v96 contract: upload validation by magic bytes, stable approved names,
// and the standardized voice answer ids including faq:<index>.

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);

test('uploads are accepted by magic bytes only; a renamed file is not spoofed through', () => {
  assert.equal(detectImageType(PNG), 'image/png');
  assert.equal(detectImageType(JPEG), 'image/jpeg');
  assert.equal(detectImageType(WEBP), 'image/webp');
  assert.equal(detectImageType(GIF), null, 'gif is not an allowed type');
  assert.equal(detectImageType(new Uint8Array(12)), null, 'zeros are not an image');
  assert.equal(detectImageType(new Uint8Array(4)), null, 'too short');
});

test('approved object names are content-hash stable so re-approval reuses the same public URL', () => {
  assert.equal(approvedObjectName(PNG), approvedObjectName(PNG));
  assert.notEqual(approvedObjectName(PNG), approvedObjectName(JPEG));
  assert.match(approvedObjectName(PNG), /^approved\/[0-9a-f]{32}\.webp$/);
});

test('candidate ids are uuids and tokens keep their shape', () => {
  assert.equal(isUuid('0f76ea42-3c8e-46d5-b105-9e95be2dadbf'), true);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isUuid(undefined), false);
  const token = 'c'.repeat(48);
  assert.equal(normalizeToken(`plw-${token}`), token);
  assert.equal(normalizeToken('x'), null);
});

const CTX = {
  businessName: 'Bosque de Bruma',
  locale: 'Heredia',
  category: 'lodging',
  services: ['Cabañas', 'Desayuno'],
  highlight: '',
  description: '',
  faqs: [
    { question: '¿Hay estacionamiento?', answer: 'Sí, gratis para huéspedes.' },
    { question: '¿Aceptan tarjetas?', answer: 'Sí.' },
  ],
};

test('the voice contract speaks stored FAQ answers by zero-based index, never raw submitted text', () => {
  assert.equal(isAnswerId('faq:0'), true);
  assert.equal(isAnswerId('faq:12'), true);
  assert.equal(isAnswerId('faq:-1'), false);
  assert.equal(isAnswerId('faq:'), false);
  assert.equal(isAnswerId('faq:001'), false, 'no leading zeros: only canonical indices');
  assert.equal(isAnswerId('welcome'), true);

  assert.equal(buildAnswer('faq:0', 'es', CTX), 'Sí, gratis para huéspedes.');
  assert.equal(buildAnswer('faq:1', 'en', CTX), 'Sí.');
  assert.equal(buildAnswer('faq:2', 'es', CTX), null, 'out of range has no answer');
  assert.equal(buildAnswer('faq:0', 'es', { ...CTX, faqs: [] }), null);

  const dirty = buildAnswer('welcome', 'es', {
    ...CTX,
    text: 'TEXTO MALICIOSO',
  });
  assert.ok(dirty && !dirty.includes('TEXTO MALICIOSO'));
});

test('the standardized request shape {token, answerId, language} still parses faq ids', () => {
  const token = 'd'.repeat(48);
  assert.deepEqual(parseVoiceRequest({ token, answerId: 'faq:0', language: 'en' }), {
    token,
    answerId: 'faq:0',
    language: 'en',
  });
  // faq:99 parses as a shape (index validity is checked against the stored faqs later).
  assert.deepEqual(parseVoiceRequest({ token, answerId: 'faq:99', language: 'en' }), {
    token,
    answerId: 'faq:99',
    language: 'en',
  });
  assert.equal(parseVoiceRequest({ token, answerId: 'welcome', language: 'fr' }), null);
});
