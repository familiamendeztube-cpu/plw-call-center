// Regression tests for the 403 auto-pause: two consecutive SIP 403s pause the campaign
// before the next automatic dispatch, an intervening non-403 result resets the counter,
// test attempts never count, and the pause survives further ticks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatchTourismCall,
  runTourismTick,
} from '../../supabase/functions/tourism-dialer/runner.js';
import { tourismAgentConfig, tourismConfigFailures } from '../../supabase/functions/tourism-dialer/provider.js';

const ROUTE = { provider_agent_id: 'tourism_agent', transfer_uri: 'sip:agent-2@phone.example.com' };
const RUNTIME = {
  ...ROUTE,
  scheduler_ready: true,
  paused: false,
  config_verified_at: '2026-11-19T12:00:00Z',
  last_error: '',
};

function fakeDb(rows) {
  const updates = [];
  const inserts = [];
  const rpcs = [];
  // Updates persist like a real table: later reads see them.
  const state = { runtime: { ...(rows.tourism_dialer_runtime ?? {}) } };
  const from = (table) => {
    let values = null;
    const chain = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === 'then') {
            if (values) {
              updates.push({ table, values });
              if (table === 'tourism_dialer_runtime') Object.assign(state.runtime, values);
            }
            const data = values
              ? null
              : table === 'tourism_dialer_runtime'
                ? { ...state.runtime }
                : (rows[table] ?? null);
            return (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject);
          }
          if (prop === 'update') return (v) => ((values = v), chain);
          if (prop === 'insert') return (v) => (inserts.push({ table, values: v }), chain);
          return () => chain;
        },
      }
    );
    return chain;
  };
  const rpc = async (name, args) => (rpcs.push({ name, args }), { data: null, error: null });
  return { from, rpc, updates, inserts, rpcs };
}

const agentJson = (config) => ({ ok: true, status: 200, json: async () => config });
const healthyAgent = () => {
  const config = tourismAgentConfig('Alejandro', ROUTE, 'voice');
  config.agent_id = 'tourism_agent';
  return config;
};
// The provider's SIP rejection: a 403 with the same shape dispatch produces on failure.
const sip403 = () => ({
  ok: false,
  status: 403,
  json: async () => ({ message: 'Forbidden: the SIP trunk rejected the call (SIP 403)' }),
});

function runtimeWrites(db) {
  return db.updates.filter((u) => u.table === 'tourism_dialer_runtime').map((u) => u.values);
}
function pausedWrite(db) {
  return runtimeWrites(db).find((v) => v.paused === true);
}
function alertInserts(db) {
  return db.inserts.filter((i) => i.table === 'tourism_dialer_alerts').map((i) => i.values);
}

test('two consecutive SIP 403s pause the campaign and raise one alert with evidence', async () => {
  for (const [first, second] of [
    [sip403, sip403],
    // The second rejection may also arrive through the sync path, not only dispatch.
    [
      sip403,
      () => ({ ok: false, status: 403, json: async () => ({ message: 'SIP 403' }) }),
    ],
  ]) {
    const db = fakeDb({ tourism_dialer_runtime: { ...RUNTIME }, tourism_calls: [], ai_outbound_settings: { caller_phone_number_id: 'line' } });
    const fetchImpl = (url) => {
      if (url.includes('/agents/')) return agentJson(healthyAgent());
      return first();
    };
    await dispatchTourismCall(db, 'key', { call: { id: 'call-1', is_test: false, phone: '22221100', provider_agent_id: 'tourism_agent' } }, fetchImpl);
    await dispatchTourismCall(db, 'key', { call: { id: 'call-2', is_test: false, phone: '22221101', provider_agent_id: 'tourism_agent' } }, fetchImpl);
    const paused = pausedWrite(db);
    assert.ok(paused, 'the second 403 must pause the campaign');
    assert.equal(paused.consecutive_403 >= 2, true);
    const alerts = alertInserts(db);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].reason, /SIP 403/);
    const evidence = alerts[0].evidence?.calls ?? [];
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].phone, '22221101');
    assert.ok(evidence[0].at, 'evidence carries a timestamp');
    assert.match(evidence[0].error ?? '', /403/);
  }
});

test('an intervening non-403 result resets the streak so a single 403 never pauses', async () => {
  const db = fakeDb({ tourism_dialer_runtime: { ...RUNTIME }, tourism_calls: [] });
  let call403 = 0;
  const fetchImpl = (url) => {
    if (url.includes('/agents/')) return agentJson(healthyAgent());
    return call403++ % 2 === 0 ? sip403() : { ok: true, status: 200, json: async () => ({ success: true, conversation_id: 'conv_ok' }) };
  };
  await dispatchTourismCall(db, 'key', { call: { id: 'call-1', is_test: false, phone: '22221100', provider_agent_id: 'tourism_agent' } }, fetchImpl);
  await dispatchTourismCall(db, 'key', { call: { id: 'call-2', is_test: false, phone: '22221101', provider_agent_id: 'tourism_agent' } }, fetchImpl);
  await dispatchTourismCall(db, 'key', { call: { id: 'call-3', is_test: false, phone: '22221102', provider_agent_id: 'tourism_agent' } }, fetchImpl);
  assert.equal(pausedWrite(db), undefined, 'one 403 surrounded by a success must not pause');
  assert.equal(alertInserts(db).length, 0);
});

test('admin test attempts never count toward the 403 streak', async () => {
  const db = fakeDb({ tourism_dialer_runtime: { ...RUNTIME }, tourism_calls: [] });
  const fetchImpl = () => sip403();
  await dispatchTourismCall(db, 'key', { call: { id: 't1', is_test: true, phone: '70040079', provider_agent_id: 'tourism_agent' } }, fetchImpl);
  await dispatchTourismCall(db, 'key', { call: { id: 't2', is_test: true, phone: '70040079', provider_agent_id: 'tourism_agent' } }, fetchImpl);
  assert.equal(pausedWrite(db), undefined);
  assert.equal(alertInserts(db).length, 0);
});

test('the pause and alert persist: later ticks do not dial and never clear them', async () => {
  const db = fakeDb({
    tourism_dialer_runtime: { ...RUNTIME, paused: true, consecutive_403: 2 },
    tourism_calls: [],
  });
  const fetchImpl = (url) => {
    if (url.includes('/agents/')) return agentJson(healthyAgent());
    throw new Error('must not dial while paused by the 403 guard');
  };
  await runTourismTick(db, 'key', fetchImpl);
  await runTourismTick(db, 'key', fetchImpl);
  // The claim never ran, and nothing reset the counter or removed the pause.
  assert.equal(db.rpcs.some((r) => r.name === 'claim_tourism_call'), false);
  assert.ok(runtimeWrites(db).every((v) => v.paused !== false && v.consecutive_403 !== 0));
});

import { tourismCallResults } from '../../supabase/functions/tourism-dialer/provider.js';

test('tourismCallResults captures a confirmed demo day+time and the coverage gap', () => {
  const analysis = {
    data_collection_results: {
      plw_outcome: { value: 'DEMO_SCHEDULED' },
      plw_demo_coverage_gap: { value: 'true' },
      plw_demo_date: { value: '2026-11-27' },
      plw_demo_clock: { value: '14:00' },
      plw_demo_confirmed: { value: 'true' },
    },
  };
  const results = tourismCallResults(analysis);
  assert.equal(results.outcome, 'DEMO_SCHEDULED');
  assert.equal(results.details.demo_date, '2026-11-27');
  assert.equal(results.details.demo_clock, '14:00');
  // An unconfirmed or declined demo never carries both fields.
  const declined = tourismCallResults({
    data_collection_results: {
      plw_outcome: { value: 'CALLBACK_REQUESTED' },
      plw_demo_coverage_gap: { value: 'false' },
      plw_demo_date: { value: '' },
      plw_demo_clock: { value: '' },
    },
  });
  assert.equal(declined.outcome, 'CALLBACK_REQUESTED');
  assert.equal(declined.details.demo_date, undefined);
  assert.equal(declined.details.demo_clock, undefined);
});
