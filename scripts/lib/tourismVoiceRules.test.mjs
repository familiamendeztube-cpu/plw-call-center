import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeToken,
  parseVoiceRequest,
  rateKey,
  cacheKey,
  windowBucket,
} from '../../supabase/functions/plw-tourism-voice/rules.ts';
import { buildAnswer, isAnswerId } from '../../supabase/functions/plw-tourism-voice/grounding.ts';

// The voice endpoint must only ever read grounded, public draft fields. These tests pin
// request validation, grounding by answer id, and the derived-line builders.

const TOKEN = 'b'.repeat(48);

test('the voice request accepts only a valid preview token, known answer id, and language', () => {
  assert.deepEqual(parseVoiceRequest({ token: TOKEN, answerId: 'welcome', language: 'es' }), {
    token: TOKEN,
    answerId: 'welcome',
    language: 'es',
  });
  assert.deepEqual(parseVoiceRequest({ token: `plw-${TOKEN}`, answerId: 'services', language: 'en' }), {
    token: TOKEN,
    answerId: 'services',
    language: 'en',
  });
  assert.equal(parseVoiceRequest({ token: 'short', answerId: 'welcome', language: 'es' }), null);
  assert.equal(parseVoiceRequest({ token: TOKEN, answerId: 'SHOUT', language: 'es' }), null);
  // Missing or unknown language is rejected; the caller must ask for es or en explicitly.
  assert.equal(parseVoiceRequest({ token: TOKEN, answerId: 'welcome' }), null);
  assert.equal(parseVoiceRequest({ token: TOKEN, answerId: 'welcome', language: 'de' }), null);
  assert.equal(normalizeToken(`plw-${TOKEN}`), TOKEN);
  assert.equal(parseVoiceRequest({ token: TOKEN, answerId: 'welcome', language: 'de' }), null, 'unknown language is rejected');
  assert.equal(parseVoiceRequest('hola'), null);
  assert.equal(isAnswerId('about'), true);
  assert.equal(isAnswerId('freeform'), false);
});

test('answers are built only from confirmed public fields, never private CRM data', () => {
  const ctx = {
    businessName: 'Bosque de Bruma',
    locale: 'Heredia',
    category: 'lodging',
    services: ['Cabañas', 'Desayuno'],
    highlight: '',
    description: '',
  };
  assert.equal(
    buildAnswer('welcome', 'es', ctx),
    'Bienvenido a la muestra del sitio de Bosque de Bruma, en Heredia.'
  );
  assert.equal(buildAnswer('services', 'en', ctx), 'Bosque de Bruma offers: Cabañas, Desayuno.');
  assert.equal(buildAnswer('location', 'es', ctx), 'Puede encontrar a Bosque de Bruma en Heredia.');
  assert.equal(buildAnswer('about', 'es', ctx), null, 'no description or highlight means no about line');

  const dirty = { ...ctx, transcript: 'SECRETO', staffNote: 'nota privada' };
  const built = buildAnswer('welcome', 'es', dirty);
  assert.ok(built && !built.includes('SECRETO') && !built.includes('nota privada'));
});

test('keys and windows are stable and text-dependent', () => {
  assert.equal(rateKey(TOKEN, '1.2.3.4'), rateKey(TOKEN, '1.2.3.4'));
  assert.notEqual(rateKey(TOKEN, '1.2.3.4'), rateKey(TOKEN, '5.6.7.8'));
  assert.equal(cacheKey('m', 'v', 'es', 'hola'), cacheKey('m', 'v', 'es', 'hola'));
  assert.notEqual(cacheKey('m', 'v', 'es', 'hola'), cacheKey('m', 'v', 'es', 'adiós'));
  assert.match(windowBucket(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});
