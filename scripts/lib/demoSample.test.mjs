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
const PATIENT_ID = 'patient_test_voice';
const ana = { voice_id: ANA_ID, name: 'Ana', labels: { gender: 'female' } };
const patient = {
  voice_id: PATIENT_ID,
  name: 'Daniel',
  category: 'premade',
  labels: { gender: 'male', age: 'young adult', language: 'en' },
};

function fakeProvider({ anaVoices = [ana], candidates = [patient], dialogue } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/v2/voices?voice_ids=')) {
      return json({ voices: anaVoices });
    }
    if (url.includes('/v2/voices?language=en')) return json({ voices: candidates });
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
  const inputs = dialogueInputs(ANA_ID, PATIENT_ID);
  assert.deepEqual(
    inputs.map((input) => input.voice_id),
    [ANA_ID, PATIENT_ID, ANA_ID, ANA_ID]
  );
  assert.equal(new Set(inputs.map((input) => input.voice_id)).size, 2);
  assert.equal(inputs[0].text, DEMO_SAMPLE_LINES[0].text);
});

test('buildDemoSample calls text-to-dialogue with both voices and returns audio', async () => {
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
    [ANA_ID, PATIENT_ID, ANA_ID, ANA_ID]
  );
  assert.deepEqual(sample.voices, [
    { role: 'ana', name: 'Ana', voice_id: ANA_ID },
    { role: 'patient', name: 'Daniel', voice_id: PATIENT_ID },
  ]);
  assert.equal(sample.audio instanceof ReadableStream, true);
});

test('patient voice must be English, adult, opposite gender and never Ana', () => {
  const candidates = [
    { voice_id: ANA_ID, name: 'Ana Copy', labels: { gender: 'male', age: 'young adult' } },
    { voice_id: 'same_gender', name: 'Sam', labels: { gender: 'female', age: 'young adult' } },
    { voice_id: 'child', name: 'Kid', labels: { gender: 'male', age: 'child' } },
    { voice_id: 'unlabelled', name: 'Blank', labels: {} },
    { voice_id: 'library', name: 'Zed', category: 'professional', labels: { gender: 'male', age: 'middle aged' } },
    patient,
  ];
  assert.deepEqual(selectPatientVoice(candidates, ana), { voice_id: PATIENT_ID, name: 'Daniel' });
});

test('invalid provider responses fail with a clear error and never produce audio', async () => {
  await assert.rejects(
    buildDemoSample({
      apiKey: 'k',
      anaVoiceId: ANA_ID,
      fetchImpl: fakeProvider({ anaVoices: [] }).fetchImpl,
    }),
    (error) => error instanceof DemoSampleError && error.status === 502
  );
  await assert.rejects(
    buildDemoSample({
      apiKey: 'k',
      anaVoiceId: ANA_ID,
      fetchImpl: fakeProvider({ candidates: [] }).fetchImpl,
    }),
    /No hay una voz de paciente en inglés/
  );
  await assert.rejects(
    buildDemoSample({
      apiKey: 'k',
      anaVoiceId: ANA_ID,
      fetchImpl: fakeProvider({
        dialogue: new Response('{"detail":"rejected"}', {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        }),
      }).fetchImpl,
    }),
    /ElevenLabs no generó la muestra/
  );
});
