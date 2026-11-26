import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleTelnyxEvent,
  sendTelnyxSms,
  verifyTelnyxSignature,
} from '../../supabase/functions/us-sms/telnyx.js';

const b64 = (buffer) => Buffer.from(buffer).toString('base64');

async function telnyxKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = b64(await crypto.subtle.exportKey('raw', pair.publicKey));
  const sign = async (timestamp, body) =>
    b64(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(`${timestamp}|${body}`)));
  return { publicKey, sign };
}

/** Records every chained call per table; reads return `rows[table]`. */
function fakeDb(rows = {}) {
  const ops = [];
  const from = (table) => {
    const op = { table, calls: [] };
    const chain = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === 'then') {
            ops.push(op);
            const reads = op.calls[0]?.[0] === 'select';
            return (resolve, reject) =>
              Promise.resolve({ data: reads ? (rows[table] ?? []) : null, error: null }).then(resolve, reject);
          }
          return (...args) => (op.calls.push([prop, ...args]), chain);
        },
      }
    );
    return chain;
  };
  return { from, ops };
}

test('only webhooks signed by our Telnyx key, and recent, are accepted', async () => {
  const { publicKey, sign } = await telnyxKeys();
  const other = await telnyxKeys();
  const now = Date.parse('2026-11-26T18:00:00Z');
  const ts = String(now / 1000);
  const body = '{"data":{"event_type":"message.received"}}';
  const signature = await sign(ts, body);
  assert.equal(await verifyTelnyxSignature(body, signature, ts, publicKey, now), true);
  assert.equal(await verifyTelnyxSignature(body + ' ', signature, ts, publicKey, now), false, 'changed body');
  assert.equal(await verifyTelnyxSignature(body, signature, ts, other.publicKey, now), false, 'someone else signed');
  assert.equal(await verifyTelnyxSignature(body, signature, ts, publicKey, now + 10 * 60_000), false, 'replayed later');
  assert.equal(await verifyTelnyxSignature(body, signature, ts, '', now), false, 'key not configured');
  assert.equal(await verifyTelnyxSignature(body, 'not-base64!', ts, publicKey, now), false);
});

test('an SMS goes out from the US number with our webhook; STOP refusals are recognised', async () => {
  const seen = [];
  const ok = await sendTelnyxSms(
    { apiKey: 'KEY', from: '+12135550100', to: '+13105550123', text: 'Hola', webhookUrl: 'https://x/us-sms?telnyx=1' },
    async (url, init) => {
      seen.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ data: { id: 'msg-1' } }) };
    }
  );
  assert.deepEqual(ok, { ok: true, id: 'msg-1' });
  assert.equal(seen[0].url, 'https://api.telnyx.com/v2/messages');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer KEY');
  assert.deepEqual(JSON.parse(seen[0].init.body), {
    from: '+12135550100', to: '+13105550123', text: 'Hola', webhook_url: 'https://x/us-sms?telnyx=1',
  });

  const stopped = await sendTelnyxSms({ apiKey: 'KEY' }, async () => ({
    ok: false,
    status: 400,
    json: async () => ({ errors: [{ code: '40300', title: 'Blocked due to STOP message' }] }),
  }));
  assert.deepEqual(stopped, { ok: false, optedOut: true, error: 'Blocked due to STOP message' });

  const down = await sendTelnyxSms({ apiKey: 'KEY' }, async () => {
    throw new Error('network');
  });
  assert.equal(down.ok, false);
});

test('delivery results update the stored SMS by its Telnyx id', async () => {
  const db = fakeDb();
  await handleTelnyxEvent(db, {
    data: { event_type: 'message.finalized', payload: { id: 'msg-1', to: [{ status: 'delivery_failed' }], errors: [{ code: '40008', title: 'Message filtered by carrier' }] } },
  });
  await handleTelnyxEvent(db, { data: { event_type: 'message.finalized', payload: { id: 'msg-2', to: [{ status: 'delivered' }] } } });
  await handleTelnyxEvent(db, { data: { event_type: 'message.finalized', payload: { id: 'msg-3', to: [{ status: 'delivery_unconfirmed' }] } } });
  assert.deepEqual(
    db.ops.map((op) => op.calls),
    [
      [['update', { status: 'failed', error: 'Message filtered by carrier' }], ['eq', 'provider_message_id', 'msg-1']],
      [['update', { status: 'delivered' }], ['eq', 'provider_message_id', 'msg-2']],
    ],
    'an unconfirmed delivery leaves the SMS as sent'
  );
});

test('a STOP reply withdraws SMS consent for every lead with that number; other replies only get stored', async () => {
  const stopDb = fakeDb({ us_leads: [{ id: 'lead-1' }, { id: 'lead-2' }] });
  const received = (text, id) => ({
    data: { event_type: 'message.received', payload: { id, text, from: { phone_number: '+13105550123' } } },
  });
  await handleTelnyxEvent(stopDb, received('STOP', 'in-1'));
  const [lookup, inbound, consent] = stopDb.ops;
  assert.deepEqual(lookup.calls[1], ['or', 'phone_e164.eq.+13105550123,sms_mobile.eq.+13105550123']);
  assert.equal(inbound.table, 'us_sms_inbound');
  assert.deepEqual(inbound.calls[0][1], {
    lead_id: 'lead-1', from_e164: '+13105550123', body: 'STOP', suppressed: true, provider_message_id: 'in-1',
  });
  assert.deepEqual(inbound.calls[0][2], { onConflict: 'provider_message_id', ignoreDuplicates: true }, 'Telnyx retries');
  assert.equal(consent.table, 'us_leads');
  assert.equal(consent.calls[0][1].sms_consent, false);
  assert.deepEqual(consent.calls[1], ['in', 'id', ['lead-1', 'lead-2']]);

  const chatDb = fakeDb({ us_leads: [{ id: 'lead-1' }] });
  await handleTelnyxEvent(chatDb, received('¿Cuánto cuesta?', 'in-2'));
  assert.deepEqual(chatDb.ops.map((op) => op.table), ['us_leads', 'us_sms_inbound']);
  assert.equal(chatDb.ops[1].calls[0][1].suppressed, false);

  const foreignDb = fakeDb();
  await handleTelnyxEvent(foreignDb, {
    data: { event_type: 'message.received', payload: { id: 'in-3', text: 'STOP', from: { phone_number: '+50688881234' } } },
  });
  assert.equal(foreignDb.ops.length, 0, 'only US numbers are stored');
});
