import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_SAMPLE_MODEL,
  DEMO_SAMPLE_TEXT,
  demoSampleRequest,
} from '../../supabase/functions/dental-dialer/demoSample.js';

test('sample uses the fixed bilingual script and a text-to-speech model', () => {
  assert.match(DEMO_SAMPLE_TEXT, /^Hola, le saluda Anna Chacón-Méndez, de Professional Latino Workers/);
  assert.match(DEMO_SAMPLE_TEXT, /Hello, thank you for calling\. Would you like to request an appointment\?/);
  assert.match(DEMO_SAMPLE_TEXT, /¿Le serviría ver una demostración con un caso de su consultorio\?$/);
  assert.equal(DEMO_SAMPLE_MODEL, 'eleven_multilingual_v2');
  assert.doesNotMatch(DEMO_SAMPLE_MODEL, /conversational/);
});

test('request targets the TTS endpoint with the key in a header only', () => {
  const { url, init } = demoSampleRequest('key-123', 'voice/abc');
  assert.equal(
    url,
    'https://api.elevenlabs.io/v1/text-to-speech/voice%2Fabc?output_format=mp3_44100_128'
  );
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['xi-api-key'], 'key-123');
  assert.equal(init.headers.Accept, 'audio/mpeg');
  assert.doesNotMatch(url, /key-123/);
  assert.deepEqual(Object.keys(JSON.parse(init.body)).sort(), ['model_id', 'text']);
  assert.equal(JSON.parse(init.body).text, DEMO_SAMPLE_TEXT);
});
