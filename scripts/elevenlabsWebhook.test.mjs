import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callFromEvent,
  readLimited,
  verifySignature,
} from '../supabase/functions/elevenlabs-webhook/rules.js';
import { postCallEvent, signatureHeader } from './lib/elevenlabsFixture.mjs';

const SECRET = 'wsec_test_secret_for_fixture_only';
const NOW = 1793750500;
const body = JSON.stringify(postCallEvent());

test('accepts a delivery signed the way the official SDK signs it', async () => {
  assert.equal(await verifySignature(signatureHeader(body, SECRET, NOW), body, SECRET, NOW), true);
});

test('rejects tampered bodies, wrong secrets, stale or future times and bad headers', async () => {
  const good = signatureHeader(body, SECRET, NOW);
  assert.equal(await verifySignature(good, body.replace('Prueba', 'Otro'), SECRET, NOW), false);
  assert.equal(await verifySignature(good, body, 'wsec_other_secret_value', NOW), false);
  assert.equal(await verifySignature(signatureHeader(body, SECRET, NOW - 1801), body, SECRET, NOW), false);
  assert.equal(await verifySignature(signatureHeader(body, SECRET, NOW + 301), body, SECRET, NOW), false);
  for (const header of [null, '', 'v0=abc', `t=${NOW}`, `t=${NOW},v0=${'z'.repeat(64)}`]) {
    assert.equal(await verifySignature(header, body, SECRET, NOW), false);
  }
  assert.equal(await verifySignature(good, body, '', NOW), false);
});

test('rejects bodies over the size limit without reading them whole', async () => {
  const request = new Request('https://plw.test', { method: 'POST', body: 'x'.repeat(11) });
  assert.equal(await readLimited(request, 10), null);
  assert.equal(await readLimited(new Request('https://plw.test', { method: 'POST', body: 'ok' }), 10), 'ok');
});

test('maps a post-call event to the stored fields', () => {
  assert.deepEqual(callFromEvent(postCallEvent()), {
    call: {
      conversation_id: 'conv_plwfixture0001',
      caller_phone: '+50600000000',
      callback_phone: null,
      customer_name: 'Prueba PLW',
      business_name: null,
      reason: 'Prueba del webhook',
      preferred_contact: 'whatsapp',
      preferred_time: 'mañana 10 am',
      consent: true,
      summary: 'Prueba de PLW: la clienta pide que la llamen mañana.',
      call_started_at: '2026-11-04T00:00:00.000Z',
      call_duration_seconds: 58,
    },
  });
});

test('missing details stay empty instead of being guessed', () => {
  const event = postCallEvent();
  event.data.analysis = {};
  delete event.data.metadata.phone_call;
  event.data.conversation_initiation_client_data = {};
  const { call } = callFromEvent(event);
  for (const field of ['caller_phone', 'customer_name', 'reason', 'preferred_contact', 'consent', 'summary']) {
    assert.equal(call[field], null, field);
  }
});

test('falls back to the caller ID variable and rejects unknown contact methods', () => {
  const event = postCallEvent();
  delete event.data.metadata.phone_call;
  event.data.analysis.data_collection_results.preferred_contact.value = 'correo';
  event.data.analysis.data_collection_results.callback_consent.value = 'sí';
  const { call } = callFromEvent(event);
  assert.equal(call.caller_phone, '+50600000000');
  assert.equal(call.preferred_contact, null);
  assert.equal(call.consent, null);
});

test('ignores other event types and other agents, refuses malformed events', () => {
  assert.deepEqual(callFromEvent(postCallEvent({ type: 'post_call_audio' })), { ignore: 'event_type' });
  const other = postCallEvent();
  other.data.agent_id = 'agent_someone_else';
  assert.deepEqual(callFromEvent(other), { ignore: 'other_agent' });
  const bad = postCallEvent();
  bad.data.conversation_id = '../../etc';
  assert.deepEqual(callFromEvent(bad), { invalid: 'malformed' });
  assert.deepEqual(callFromEvent(null), { invalid: 'malformed' });
});
