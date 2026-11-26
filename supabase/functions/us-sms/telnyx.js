// Telnyx Messaging for the US campaign: send, verify webhooks, and record delivery and replies.
// Plain JS with no imports so the node tests can load it (scripts/lib/usSms.test.mjs).

const TELNYX_MESSAGES = 'https://api.telnyx.com/v2/messages';
const REPLAY_WINDOW_S = 300;
const US_E164 = /^\+1[2-9][0-9]{9}$/;
const STOP = /^(stop|stopall|unsubscribe|cancel|end|quit|baja|deténgase|detengase|no más|no mas)\b/i;

const bytes = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/**
 * Telnyx signs "<telnyx-timestamp>|<raw body>" with Ed25519; the public key is in the Telnyx
 * portal (Keys & Credentials > Public Key). Old timestamps are refused so a captured webhook
 * can't be replayed.
 */
export async function verifyTelnyxSignature(rawBody, signature, timestamp, publicKey, now = Date.now()) {
  if (!rawBody || !signature || !timestamp || !publicKey) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > REPLAY_WINDOW_S) return false;
  try {
    const key = await crypto.subtle.importKey('raw', bytes(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      bytes(signature),
      new TextEncoder().encode(`${timestamp}|${rawBody}`)
    );
  } catch {
    return false;
  }
}

/** Sends one SMS. `optedOut` means Telnyx refused it because the number replied STOP. */
export async function sendTelnyxSms({ apiKey, from, to, text, webhookUrl }, fetchImpl = fetch) {
  let response;
  let data = null;
  try {
    response = await fetchImpl(TELNYX_MESSAGES, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, text, webhook_url: webhookUrl }),
      signal: AbortSignal.timeout(20000),
    });
    data = await response.json().catch(() => null);
  } catch {
    return { ok: false, optedOut: false, error: 'Telnyx no respondió.' };
  }
  const id = data?.data?.id;
  if (response.ok && typeof id === 'string') return { ok: true, id };
  const first = Array.isArray(data?.errors) ? data.errors[0] : null;
  return {
    ok: false,
    // /v2/messages returns 40300 "Blocked due to STOP message" for opted-out recipients.
    optedOut: String(first?.code ?? '') === '40300',
    error: String(first?.detail || first?.title || `HTTP ${response.status}`).slice(0, 280),
  };
}

const FINAL_STATUS = { delivered: 'delivered', delivery_failed: 'failed', sending_failed: 'failed' };

async function checked(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * message.finalized updates the stored SMS; message.received stores the reply and, on STOP,
 * withdraws SMS consent for every lead with that number. Telnyx retries webhooks, so a reply
 * already stored is ignored. HELP/STOP auto-answers are the Telnyx messaging profile's job.
 */
export async function handleTelnyxEvent(db, event) {
  const type = event?.data?.event_type;
  const payload = event?.data?.payload ?? {};
  if (typeof payload.id !== 'string') return;

  if (type === 'message.finalized') {
    const status = FINAL_STATUS[payload.to?.[0]?.status];
    if (!status) return;
    const error = payload.errors?.[0];
    await checked(
      db
        .from('us_sms_messages')
        .update({
          status,
          ...(status === 'failed' ? { error: String(error?.detail || error?.title || error?.code || '').slice(0, 300) } : {}),
        })
        .eq('provider_message_id', payload.id)
    );
    return;
  }

  if (type !== 'message.received') return;
  const from = String(payload.from?.phone_number ?? '');
  if (!US_E164.test(from)) return;
  const text = String(payload.text ?? '').slice(0, 500);
  const suppressed = STOP.test(text.trim());
  const leads = (await checked(db.from('us_leads').select('id').or(`phone_e164.eq.${from},sms_mobile.eq.${from}`))) ?? [];
  await checked(
    db.from('us_sms_inbound').upsert(
      { lead_id: leads[0]?.id ?? null, from_e164: from, body: text, suppressed, provider_message_id: payload.id },
      { onConflict: 'provider_message_id', ignoreDuplicates: true }
    )
  );
  if (suppressed && leads.length)
    await checked(
      db
        .from('us_leads')
        .update({ sms_consent: false, updated_at: new Date().toISOString() })
        .in('id', leads.map((lead) => lead.id))
    );
}
