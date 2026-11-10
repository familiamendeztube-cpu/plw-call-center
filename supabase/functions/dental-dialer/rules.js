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

export const FIELD_IDS = [
  'customer_name',
  'business_name',
  'business_type',
  'call_reason',
  'preferred_contact',
  'callback_time',
  'callback_phone',
  'callback_consent',
  'call_summary',
];

/**
 * The schema allows entries keyed by identifier, keyed by an internal ID with the
 * identifier in `name`, or listed in `data_collection_results_list`. Every entry is
 * indexed by its key, `data_collection_id` and `name`, lowercased.
 */
function collectedValues(analysis) {
  const map = analysis?.data_collection_results;
  const list = analysis?.data_collection_results_list;
  const entries = [
    ...(map && typeof map === 'object' && !Array.isArray(map) ? Object.entries(map) : []),
    ...[...(Array.isArray(map) ? map : []), ...(Array.isArray(list) ? list : [])].map((entry) => [null, entry]),
  ];
  const values = new Map();
  for (const [key, entry] of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    for (const id of [key, entry.data_collection_id, entry.name]) {
      const name = typeof id === 'string' ? id.trim().toLowerCase() : '';
      if (name && !values.has(name)) values.set(name, entry.value ?? null);
    }
  }
  return { values, entryCount: entries.length };
}

function bool(value) {
  if (typeof value === 'boolean') return value;
  const clean = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return clean === 'true' ? true : clean === 'false' ? false : null;
}

// The agent records what the caller said, often in Spanish ("Llamada telefónica", "por WhatsApp").
function contactMethod(value) {
  const clean = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (clean.includes('whats')) return 'whatsapp';
  return /phone|call|llamad|tel[eé]f/.test(clean) ? 'phone' : null;
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

  const { values, entryCount } = collectedValues(data.analysis);
  const value = (id) => values.get(id) ?? null;
  const duration = metadata.call_duration_secs;
  // Delivery and field persistence are separate outcomes; these codes flag the second.
  const fieldsIssue =
    entryCount === 0 ? 'no_collected_fields' : FIELD_IDS.some((id) => values.has(id)) ? null : 'fields_not_matched';

  return {
    fieldsIssue,
    call: {
      conversation_id: conversationId,
      caller_phone:
        phone(metadata.phone_call?.external_number) ??
        phone(data.conversation_initiation_client_data?.dynamic_variables?.system__caller_id),
      callback_phone: phone(value('callback_phone')),
      customer_name: text(value('customer_name'), 120),
      business_name: text(value('business_name'), 160),
      business_type: text(value('business_type'), 120),
      reason: text(value('call_reason'), 500),
      preferred_contact: contactMethod(value('preferred_contact')),
      preferred_time: text(value('callback_time'), 200),
      consent: bool(value('callback_consent')),
      // ElevenLabs writes transcript_summary in English; the call_summary field is asked for in Spanish.
      summary: text(value('call_summary'), 4000) ?? text(data.analysis?.transcript_summary, 4000),
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
export function shouldRouteToAgent(call) {
  return true;
}
