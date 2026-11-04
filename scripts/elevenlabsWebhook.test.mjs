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
    fieldsIssue: null,
    call: {
      conversation_id: 'conv_plwfixture0001',
      caller_phone: '+50600000000',
      callback_phone: null,
      customer_name: 'Prueba PLW',
      business_name: null,
      business_type: null,
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

const COLLECTED = {
  customer_name: 'Cliente Prueba',
  business_name: 'Negocio Prueba',
  business_type: 'Restaurante',
  call_reason: 'Automatizar su negocio',
  preferred_contact: 'WhatsApp',
  callback_time: 'Cualquier hora',
  callback_phone: '60000000',
  callback_consent: true,
};
const EXPECTED = {
  customer_name: 'Cliente Prueba',
  business_name: 'Negocio Prueba',
  business_type: 'Restaurante',
  reason: 'Automatizar su negocio',
  preferred_contact: 'whatsapp',
  preferred_time: 'Cualquier hora',
  callback_phone: '60000000',
  consent: true,
};
const pick = (call) => Object.fromEntries(Object.keys(EXPECTED).map((key) => [key, call[key]]));

function withAnalysis(analysis) {
  const event = postCallEvent();
  event.data.analysis = { transcript_summary: 'Resumen', ...analysis };
  return callFromEvent(event);
}

test('reads entries keyed by an internal ID with the identifier in name', () => {
  const map = Object.fromEntries(
    Object.entries(COLLECTED).map(([name, value], index) => [
      `dc_${index}`,
      { data_collection_id: `dc_${index}`, name, value, rationale: '' },
    ])
  );
  const result = withAnalysis({ data_collection_results: map });
  assert.deepEqual(pick(result.call), EXPECTED);
  assert.equal(result.fieldsIssue, null);
});

test('reads data_collection_results_list when the map is empty', () => {
  const list = Object.entries(COLLECTED).map(([id, value]) => ({ data_collection_id: id, value }));
  const result = withAnalysis({ data_collection_results: {}, data_collection_results_list: list });
  assert.deepEqual(pick(result.call), EXPECTED);
});

test('matches identifiers regardless of case and spacing', () => {
  const result = withAnalysis({
    data_collection_results: { ' Customer_Name ': { value: 'Cliente Prueba' } },
  });
  assert.equal(result.call.customer_name, 'Cliente Prueba');
});

test('keeps consent false, reads true/false text, and leaves anything else empty', () => {
  const consent = (value) =>
    withAnalysis({ data_collection_results: { callback_consent: { value } } }).call.consent;
  assert.equal(consent(false), false);
  assert.equal(consent(true), true);
  assert.equal(consent('false'), false);
  assert.equal(consent('TRUE'), true);
  assert.equal(consent(null), null);
  assert.equal(consent(undefined), null);
  assert.equal(consent('sí'), null);
});

test('prefers the Spanish call_summary field over the English transcript summary', () => {
  const spanish = withAnalysis({
    data_collection_results: { call_summary: { value: 'Pedro quiere automatizar sus contactos.' } },
  });
  assert.equal(spanish.call.summary, 'Pedro quiere automatizar sus contactos.');
  assert.equal(withAnalysis({ data_collection_results: {} }).call.summary, 'Resumen');
});

test('flags a saved call whose collected fields could not be read', () => {
  assert.equal(withAnalysis({}).fieldsIssue, 'no_collected_fields');
  assert.equal(withAnalysis({ data_collection_results: {} }).fieldsIssue, 'no_collected_fields');
  assert.equal(
    withAnalysis({ data_collection_results: { nombre: { value: 'Cliente' } } }).fieldsIssue,
    'fields_not_matched'
  );
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
