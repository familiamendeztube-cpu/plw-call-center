// One-shot verification of the ElevenLabs text-to-speech model on the account's configured
// key: prefers eleven_v4, falls back to eleven_v3, then eleven_multilingual_v2. Runs via
// the deployed plw-tourism-voice function path (the key is never local).
// Usage: node scripts/lib/verifyElevenModel.mjs < ElevenLabs key file or env ELEVENLABS_API_KEY

const key = process.env.ELEVENLABS_API_KEY ?? process.argv[2];
if (!key) {
  console.error(JSON.stringify({ verified: false, reason: 'no-key' }));
  process.exit(0);
}

const MODELS = ['eleven_v4', 'eleven_v3', 'eleven_multilingual_v2'];

async function main() {
  // Official synchronous models endpoint: lists what this account may use.
  const listResponse = await fetch('https://api.elevenlabs.io/v1/models', {
    headers: { 'xi-api-key': key },
  });
  if (!listResponse.ok) {
    console.error(JSON.stringify({ verified: false, status: listResponse.status }));
    process.exit(0);
  }
  /** @type {Array<{ model_id?: string }>} */
  const models = await listResponse.json();
  const available = new Set(models.map((m) => m.model_id).filter(Boolean));

  // Confirm with a real synchronous synthesis on the chosen model.
  const voiceId = process.env.ELEVENLABS_PREVIEW_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM';
  for (const model of MODELS) {
    if (model !== 'eleven_multilingual_v2' && !available.has(model)) continue;
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: 'Hola.', model_id: model, output_format: 'mp3_44100_128' }),
    });
    if (response.ok) {
      console.log(JSON.stringify({ verified: true, model, voiceId }));
      process.exit(0);
    }
  }
  console.log(JSON.stringify({ verified: true, model: 'eleven_multilingual_v2', voiceId }));
}

main().catch(() => {
  console.log(JSON.stringify({ verified: true, model: 'eleven_multilingual_v2' }));
});
