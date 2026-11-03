// The only ElevenLabs agent whose calls PLW stores. Other agents in the workspace are ignored.
export const PLW_AGENT_ID = 'agent_8601m6hbjwamevz887627c1qp0sq';
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_AGE_SECONDS = 30 * 60; // Same window as the official SDK.
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const CONVERSATION_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Reads at most `max` bytes; returns null when the body is larger. */
export async function readLimited(req, max = MAX_BODY_BYTES) {
  if (Number(req.headers.get('content-length') ?? 0) > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new Blob(chunks).text();
}

function hexBytes(hex) {
  return Uint8Array.from(hex.match(/../g), (pair) => parseInt(pair, 16));
}

/**
 * ElevenLabs-Signature: t=<unix seconds>,v0=<hex HMAC-SHA256 of "<t>.<raw body>">.
 * crypto.subtle.verify compares in constant time, unlike the SDK's string compare.
 */
export async function verifySignature(header, rawBody, secret, nowSeconds = Date.now() / 1000) {
  if (typeof header !== 'string' || typeof secret !== 'string' || secret === '') return false;
  const parts = header.split(',').map((part) => part.trim());
  const t = parts.find((part) => part.startsWith('t='))?.slice(2) ?? '';
  const v0 = parts.find((part) => part.startsWith('v0='))?.slice(3) ?? '';
  if (!/^[0-9]{1,12}$/.test(t) || !/^[0-9a-f]{64}$/.test(v0)) return false;
  const age = nowSeconds - Number(t);
  if (age > MAX_AGE_SECONDS || age < -MAX_CLOCK_SKEW_SECONDS) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify('HMAC', key, hexBytes(v0), encoder.encode(`${t}.${rawBody}`));
}

function text(value, max) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}

function phone(value) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\s().-]/g, '');
  return /^\+?[0-9]{3,20}$/.test(clean) ? clean : null;
}

function isoFromUnix(seconds) {
  return Number.isInteger(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

/** Turns a verified webhook event into the fields PLW stores, or says why it is skipped. */
export function callFromEvent(event) {
  if (typeof event !== 'object' || event === null) return { invalid: 'malformed' };
  if (event.type !== 'post_call_transcription') return { ignore: 'event_type' };
  const data = event.data;
  if (typeof data !== 'object' || data === null) return { invalid: 'malformed' };
  if (data.agent_id !== PLW_AGENT_ID) return { ignore: 'other_agent' };
  if (typeof data.conversation_id !== 'string' || !CONVERSATION_ID.test(data.conversation_id)) {
    return { invalid: 'malformed' };
  }
  const conversationId = data.conversation_id;
  const metadata = data.metadata ?? {};
  const startedAt = isoFromUnix(metadata.start_time_unix_secs) ?? isoFromUnix(event.event_timestamp);
  if (!startedAt) return { invalid: 'missing_start_time', conversationId };

  const collected = data.analysis?.data_collection_results ?? {};
  const value = (id) => collected[id]?.value;
  const contact = typeof value('preferred_contact') === 'string' ? value('preferred_contact').trim().toLowerCase() : '';
  const duration = metadata.call_duration_secs;

  return {
    call: {
      conversation_id: conversationId,
      caller_phone:
        phone(metadata.phone_call?.external_number) ??
        phone(data.conversation_initiation_client_data?.dynamic_variables?.system__caller_id),
      callback_phone: phone(value('callback_phone')),
      customer_name: text(value('customer_name'), 120),
      business_name: text(value('business_name'), 160),
      reason: text(value('call_reason'), 500),
      preferred_contact: ['phone', 'whatsapp'].includes(contact) ? contact : null,
      preferred_time: text(value('callback_time'), 200),
      consent: typeof value('callback_consent') === 'boolean' ? value('callback_consent') : null,
      summary: text(data.analysis?.transcript_summary, 4000),
      call_started_at: startedAt,
      call_duration_seconds: Number.isInteger(duration) && duration >= 0 ? duration : null,
    },
  };
}

/**
 * Decides whether a saved AI call goes to an agent through round-robin.
 * Calls that return false are still saved and visible to administrators,
 * but no customer is created and no agent's capacity is used.
 */
// Owner's choice for now: every AI call goes to an agent. Tighten here (no phone,
// consent === false, very short calls) if agents start receiving noise.
// eslint-disable-next-line no-unused-vars
export function shouldRouteToAgent(call) {
  return true;
}
