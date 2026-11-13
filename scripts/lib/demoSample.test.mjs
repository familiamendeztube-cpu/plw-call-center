import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_SAMPLE_LABEL,
  DEMO_SAMPLE_LINES,
  DEMO_SAMPLE_MODEL,
  DemoSampleError,
  buildDemoSample,
  dialogueInputs,
  selectPatientVoice,
} from '../../supabase/functions/dental-dialer/demoSample.js';

const ANA_ID = 'ana_test_voice';
const ana = {
  voice_id: ANA_ID,
  name: 'Ana',
  labels: { gender: 'female' },
  verified_languages: [{ language: 'es' }],
};
const englishMan = {
  voice_id: 'english_man',
  name: 'Daniel',
  category: 'premade',
  labels: { gender: 'male', age: 'young adult' },
  verified_languages: [{ language: 'en' }],
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeProvider({ pages = [{ voices: [ana, englishMan] }], dialogue } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/v2/voices')) {
      const token = new URL(url).searchParams.get('next_page_token');
      const index = token ? Number(token) : 0;
      const page = pages[index];
      const hasMore = index < pages.length - 1;
      return json({ ...page, has_more: hasMore, next_page_token: hasMore ? String(index + 1) : null });
    }
    if (url.includes('/v1/text-to-dialogue')) {
      return dialogue ?? new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { fetchImpl, calls };
}

test('script keeps the approved speaker order and fits the dialogue limit', () => {
  assert.deepEqual(
    DEMO_SAMPLE_LINES.map((line) => line.speaker),
    ['ana', 'patient', 'ana', 'ana']
  );
  assert.match(DEMO_SAMPLE_LINES[1].text, /I don’t speak Spanish\.$/);
  const total = DEMO_SAMPLE_LINES.reduce((sum, line) => sum + line.text.length, 0);
  assert.ok(total <= 2000, `dialogue text is ${total} characters`);
  assert.equal(DEMO_SAMPLE_MODEL, 'eleven_v3');
  assert.match(DEMO_SAMPLE_LABEL, /Demostración simulada de dos voces — no es una llamada real/);
});

test('dialogue inputs give Ana and the patient two distinct voice IDs in script order', () => {
  const inputs = dialogueInputs(ANA_ID, 'patient_voice');
  assert.deepEqual(
    inputs.map((input) => input.voice_id),
    [ANA_ID, 'patient_voice', ANA_ID, ANA_ID]
  );
});

test('picks a verified English voice even when labels are missing', () => {
  const patient = selectPatientVoice([ana, englishMan], ana);
  assert.equal(patient.voice_id, 'english_man');
  assert.equal(patient.match, 'english_verified');
});

test('prefers verified English over an opposite-gender voice without English, as a preference only', () => {
  const sameGenderEnglish = {
    voice_id: 'same_gender_en',
    name: 'Laura',
    labels: { gender: 'female', age: 'middle aged' },
    verified_languages: [{ language: 'en-US' }],
  };
  const otherGenderSpanish = {
    voice_id: 'spanish_man',
    name: 'Mateo',
    labels: { gender: 'male', age: 'young adult' },
    verified_languages: [{ language: 'es' }],
  };
  assert.equal(
    selectPatientVoice([ana, otherGenderSpanish, sameGenderEnglish], ana).voice_id,
    'same_gender_en'
  );
});

test('falls back to an unlabelled adult voice and reports that it is unverified', () => {
  const unlabelled = { voice_id: 'plain', name: 'Plain', labels: {} };
  const patient = selectPatientVoice([ana, unlabelled], ana);
  assert.equal(patient.voice_id, 'plain');
  assert.equal(patient.match, 'language_unverified');
});

test('never chooses Ana, a same-named voice, or a child voice', () => {
  const copyOfAna = { voice_id: 'copy', name: 'ana', labels: { gender: 'male' }, verified_languages: [{ language: 'en' }] };
  const child = {
    voice_id: 'child',
    name: 'Kid',
    labels: { gender: 'male', age: 'child' },
    verified_languages: [{ language: 'en' }],
  };
  assert.throws(
    () => selectPatientVoice([ana, copyOfAna, child], ana),
    (error) => error instanceof DemoSampleError && error.status === 502 && error.diagnostics.scanned === 3
  );
});

test('follows pagination until a voice is found and sends the page token', async () => {
  const { fetchImpl, calls } = fakeProvider({
    pages: [
      { voices: [ana] },
      { voices: [{ voice_id: 'other', name: 'Other', labels: {} }] },
      { voices: [englishMan] },
    ],
  });
  const sample = await buildDemoSample({ apiKey: 'key-123', anaVoiceId: ANA_ID, fetchImpl });
  const listCalls = calls.filter((call) => call.url.includes('/v2/voices'));
  assert.equal(listCalls.length, 3);
  assert.equal(new URL(listCalls[1].url).searchParams.get('next_page_token'), '1');
  assert.equal(listCalls[0].url.includes('key-123'), false);
  assert.equal(sample.voices[1].voice_id, 'english_man');
});

test('pagination stops after the bounded page count', async () => {
  const page = { voices: [{ voice_id: 'x', name: 'X', labels: {} }] };
  const { fetchImpl, calls } = fakeProvider({ pages: Array.from({ length: 9 }, () => page) });
  await assert.rejects(
    buildDemoSample({ apiKey: 'k', anaVoiceId: ANA_ID, fetchImpl }),
    (error) => error.message.includes('no aparece')
  );
  assert.equal(calls.filter((call) => call.url.includes('/v2/voices')).length, 5);
});

test('buildDemoSample sends both voices to text-to-dialogue and returns audio with roles', async () => {
  const { fetchImpl, calls } = fakeProvider();
  const sample = await buildDemoSample({ apiKey: 'key-123', anaVoiceId: ANA_ID, fetchImpl });
  const dialogue = calls.find((call) => call.url.includes('/v1/text-to-dialogue'));
  assert.match(dialogue.url, /output_format=mp3_44100_128$/);
  assert.equal(dialogue.init.headers['xi-api-key'], 'key-123');
  assert.equal(dialogue.url.includes('key-123'), false);
  const body = JSON.parse(dialogue.init.body);
  assert.equal(body.model_id, 'eleven_v3');
  assert.deepEqual(
    body.inputs.map((input) => input.voice_id),
    [ANA_ID, 'english_man', ANA_ID, ANA_ID]
  );
  assert.deepEqual(sample.voices, [
    { role: 'ana', name: 'Ana', voice_id: ANA_ID },
    { role: 'patient', name: 'Daniel', voice_id: 'english_man', match: 'english_verified' },
  ]);
});

test('provider failures surface HTTP status and diagnostics without audio', async () => {
  const failingVoices = async () => new Response('{"detail":"forbidden"}', { status: 403 });
  await assert.rejects(
    buildDemoSample({ apiKey: 'k', anaVoiceId: ANA_ID, fetchImpl: failingVoices }),
    /HTTP 403/
  );

  const { fetchImpl: noAna } = fakeProvider({ pages: [{ voices: [englishMan] }] });
  await assert.rejects(
    buildDemoSample({ apiKey: 'k', anaVoiceId: ANA_ID, fetchImpl: noAna }),
    (error) => error.message.includes('no aparece') && error.diagnostics.scanned === 1
  );

  const { fetchImpl: rejected } = fakeProvider({
    dialogue: new Response('{"detail":"rejected"}', {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  await assert.rejects(
    buildDemoSample({ apiKey: 'k', anaVoiceId: ANA_ID, fetchImpl: rejected }),
    /HTTP 422/
  );
});
