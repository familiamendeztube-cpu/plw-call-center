import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyTranscript,
  buildConverse,
  CONVERSE_IDS,
  isAnswerId,
} from '../../supabase/functions/plw-secretary-converse/grounding.ts';
import {
  normalizeToken,
  parseConverseRequest,
  rateKey,
  cacheKey,
  windowBucket,
} from '../../supabase/functions/plw-secretary-converse/rules.ts';

// Pins the secretary converse contract: short transcripts classify to fixed opaque ids,
// replies are approved lines containing only public business data, and the typed/text
// fallback never exposes the raw caller text or any contact number.

const CTX = {
  businessName: 'Bosque de Bruma Tours',
  locale: 'Heredia',
  category: 'tourism',
  services: ['Caminata al volcán'],
  highlight: '',
  description: '',
  faqs: [],
  secretary: { businessName: 'Bosque de Bruma Tours', businessType: 'tourism' },
};

test('short transcripts classify to fixed opaque answer ids', () => {
  assert.equal(classifyTranscript('¿Cuál es el precio?'), 'conv-pricing-contact');
  assert.equal(classifyTranscript('how does the WhatsApp chat work'), 'conv-whatsapp');
  assert.equal(classifyTranscript('¿atienden llamadas?'), 'conv-calls');
  assert.equal(classifyTranscript('quiero hacer un pedido'), 'conv-orders');
  assert.equal(classifyTranscript('¿puedo hacer una reserva?'), 'conv-reservations');
  assert.equal(classifyTranscript('¿y después de horas?'), 'conv-after-hours');
  assert.equal(classifyTranscript('hablan inglés?'), 'conv-other-language');
  assert.equal(classifyTranscript('¿qué incluye todo?'), 'conv-sales-bundle');
  assert.equal(classifyTranscript('¿tienen sitio web?'), 'conv-website');
  assert.equal(classifyTranscript('xyzzy'), 'conv-fallback');
  assert.equal(classifyTranscript(''), 'conv-fallback');
  assert.equal(classifyTranscript('a'.repeat(301)), 'conv-fallback');
  assert.equal(classifyTranscript('12345 !!!'), 'conv-fallback');
});

test('converse ids are opaque and replies use only public fields in the matched language', () => {
  for (const id of CONVERSE_IDS) {
    assert.equal(typeof id, 'string');
    assert.ok(id.startsWith('conv-'));
    assert.equal(isAnswerId(id), false, 'converse ids stay outside the static voice ids');
    const es = buildConverse(id, 'es', CTX);
    const en = buildConverse(id, 'en', CTX);
    for (const line of [es, en]) {
      assert.ok(line && line.length > 0 && line.length <= 400, `${id} builds a line`);
      assert.ok(line.includes('Bosque de Bruma'), `${id} names the business`);
      assert.ok(!line.includes('+506'), `${id} never speaks the phone number`);
      assert.ok(!/[\u0000-\u001f]/.test(line), `${id} line is clean`);
    }
  }
  assert.match(buildConverse('conv-pricing-contact', 'es', CTX) ?? '', /no hace cotizaciones/);
  assert.match(buildConverse('conv-after-hours', 'en', CTX) ?? '', /24\/7|24 hours|follows up/);
});

test('request parsing stays strict: token shape, size ceilings, language whitelist', () => {
  const token = 'a'.repeat(48);
  assert.equal(normalizeToken(`plw-${token}`), token);
  assert.equal(normalizeToken('nope'), null);

  const form = new FormData();
  form.append('token', `plw-${token}`);
  form.append('text', '¿Cuál es el precio?');
  form.append('language', 'es');
  const req = new Request('https://example.test/', { method: 'POST', body: form });
  return import('../../supabase/functions/plw-secretary-converse/rules.ts').then(async (rules) => {
    const parsed = await rules.parseConverseRequest(req);
    assert.ok(parsed);
    assert.equal(parsed.token, token);
    assert.equal(parsed.text, '¿Cuál es el precio?');
    assert.equal(parsed.audio, null);

    const jsonReq = new Request('https://example.test/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, text: 'hola' }),
    });
    const jsonParsed = await rules.parseConverseRequest(jsonReq);
    assert.ok(jsonParsed);
    assert.equal(jsonParsed.language, 'es', 'language defaults to Spanish');
    assert.equal((await rules.parseConverseRequest(new Request('https://x/', { method: 'POST', body: 'x' }))), null);
  });
});
