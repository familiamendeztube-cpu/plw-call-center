// Sends the signed test call twice to the deployed webhook: the second delivery must
// return the same request ID. Run it yourself; it reads the secret from your shell and
// never prints it:  ELEVENLABS_WEBHOOK_SECRET=... node scripts/send-elevenlabs-fixture.mjs
import { postCallEvent, signatureHeader } from './lib/elevenlabsFixture.mjs';

const URL = 'https://meagbbmittuhdgwnhvxa.supabase.co/functions/v1/elevenlabs-webhook';
const secret = process.env.ELEVENLABS_WEBHOOK_SECRET ?? '';
if (!secret) {
  console.error('Set ELEVENLABS_WEBHOOK_SECRET in this shell first.');
  process.exit(1);
}

const event = postCallEvent();
event.data.metadata.start_time_unix_secs = Math.floor(Date.now() / 1000) - 60;
const body = JSON.stringify(event);

async function send(label, signature) {
  const response = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ElevenLabs-Signature': signature },
    body,
  });
  console.log(label, response.status, await response.text());
}

await send('first delivery:', signatureHeader(body, secret));
await send('repeat delivery:', signatureHeader(body, secret));
await send('bad signature (expect 401):', signatureHeader(body, 'wsec_wrong_secret_value'));
