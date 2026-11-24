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
import { draftFromKikeSite } from '../../supabase/functions/plw-secretary-converse/kikeDraft.ts';

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

test('real visitor questions get the matching answer, not a keyword accident', () => {
  const cases = [
    ['¿Atienden turistas de todo Costa Rica?', 'conv-fallback'], // "Costa" is not "costo"
    ['¿En qué calle están ubicados?', 'conv-location'], // "calle" is not "call"
    ['Buenas tardes, ¿qué tours tienen?', 'conv-services'], // a greeting is not after-hours
    ['¿El tour incluye almuerzo?', 'conv-services'], // not the PLW sales bundle
    ['¿Cuál es el horario?', 'conv-after-hours'],
    ['¿Tienen disponibilidad el sábado?', 'conv-reservations'],
    ['¿Cuánto vale el tour?', 'conv-pricing-contact'],
    ['¿Qué hay en el menú?', 'conv-services'],
    ['Quiero dejar un mensaje', 'conv-calls'],
  ];
  for (const [question, expected] of cases) assert.equal(classifyTranscript(question), expected, question);
});

test("the owner's own FAQs and facts answer first, with the owner's words", () => {
  const ctx = {
    ...CTX,
    faqs: [{ question: '¿Incluye almuerzo?', answer: 'Sí, almuerzo típico incluido.' }],
    facts: [{ label: 'Horario', value: '8 am a 5 pm' }],
  };
  assert.equal(classifyTranscript('¿El tour incluye almuerzo?', ctx), 'faq:0');
  assert.equal(buildConverse('faq:0', 'es', ctx), 'Sí, almuerzo típico incluido.');
  assert.equal(classifyTranscript('¿Cuál es el horario?', ctx), 'fact:0');
  assert.equal(buildConverse('fact:0', 'es', ctx), 'Horario: 8 am a 5 pm');
  // One shared word is not enough for a longer FAQ question.
  const long = { ...CTX, faqs: [{ question: '¿El tour al volcán incluye transporte?', answer: 'Sí.' }] };
  assert.equal(classifyTranscript('¿Qué tours tienen?', long), 'conv-services');
  // Services and location come from the draft; without them the reply is the fallback list.
  assert.equal(buildConverse('conv-services', 'es', CTX), 'Bosque de Bruma Tours ofrece: Caminata al volcán.');
  assert.equal(buildConverse('conv-location', 'es', { ...CTX, locale: '' }), null);
});

test('the voice and converse functions ship the same grounding and the same allowed sites', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (path) => readFileSync(new URL(`../../supabase/functions/${path}`, import.meta.url), 'utf8');
  // Each function deploys only its own folder, so the registry is copied; it must not drift.
  assert.equal(read('plw-tourism-voice/grounding.ts'), read('plw-secretary-converse/grounding.ts'));
  assert.equal(read('plw-tourism-voice/kikeDraft.ts'), read('plw-secretary-converse/kikeDraft.ts'));
  const origins = (source) => [...source.matchAll(/'(https?:\/\/[^']+)'/g)].map((m) => m[1]).filter((url) => !url.includes('api.'));
  const lists = [
    'plw-tourism-preview/index.ts',
    'plw-tourism-voice/rules.ts',
    'plw-secretary-converse/rules.ts',
    'plw-site-images/rules.ts',
  ].map((path) => origins(read(path)).sort());
  for (const list of lists) assert.deepEqual(list, lists[0]);
});

test('a Kike Code draft reads as a sample: its name, type, services, FAQ, place and hours', () => {
  const draft = draftFromKikeSite({
    slug: 'nicaraguan-restaurant',
    brand: { name: 'Soda La Esquina', city: 'Escazú', phone: '+506 8888-1234', address: 'Frente al parque', email: 'a@b.cr' },
    content: {
      es: {
        hero: { title1: 'Comida casera,', title2: 'como en casa', subtitle: 'Desayunos y almuerzos todos los días.' },
        services: { items: [{ title: 'Desayunos' }, { title: 'Almuerzos' }, { title: '' }] },
        faq: { items: [{ q: '¿Tienen parqueo?', a: 'Sí, frente al local.' }, { q: 'Sin respuesta', a: '' }] },
        footer: { hours: 'Lun–Sáb 7:00 a. m. – 4:00 p. m.' },
      },
    },
  });
  assert.equal(draft.business_name, 'Soda La Esquina');
  assert.equal(draft.secretary_name, 'Soda La Esquina');
  assert.equal(draft.secretary_type, 'restaurant');
  assert.equal(draft.locale, 'Escazú');
  assert.deepEqual(draft.services, ['Desayunos', 'Almuerzos']);
  assert.deepEqual(draft.faqs, [{ question: '¿Tienen parqueo?', answer: 'Sí, frente al local.' }]);
  assert.deepEqual(draft.facts.map((f) => f.label), ['Dirección', 'Horario']);
  assert.ok(!JSON.stringify(draft).includes('8888'), 'never carries the phone number');
  assert.equal(draftFromKikeSite({ slug: 'chales-garage', brand: {} }).secretary_type, 'auto');
  assert.equal(draftFromKikeSite({ slug: 'garage-doors' }).secretary_type, 'services');
  assert.equal(draftFromKikeSite(null).business_name, '');
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
  // A Kike Code preview keeps its prefix (it decides where the draft is read and counted).
  const kike = `kike-${'b'.repeat(64)}`;
  assert.equal(normalizeToken(kike), kike);
  assert.equal(normalizeToken(`kike-${'b'.repeat(63)}`), null);
  assert.equal(normalizeToken(`kike-${'B'.repeat(64)}`), null);
  assert.equal(normalizeToken('b'.repeat(64)), null);

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
