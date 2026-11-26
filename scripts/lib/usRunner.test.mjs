import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatchUsCall,
  isPaused,
  runUsTick,
  syncUsCalls,
} from '../../supabase/functions/us-dialer/runner.js';
import { usAgentConfig, usAsrKeywords, usConfigFailures, normalizeUsPhone, looksLikeUsWithCountryCode, findPhoneNumberId } from '../../supabase/functions/us-dialer/provider.js';
import {
  US_SCRIPT_VERSION,
  US_FIRST_MESSAGE,
  usPrompt,
  PLW_US_ADDRESS,
} from '../../supabase/functions/us-dialer/usScript.js';

const ROUTE = { provider_agent_id: 'us_agent', transfer_uri: '+17547991065' };
const RUNTIME = {
  ...ROUTE,
  scheduler_ready: true,
  paused: false,
  config_verified_at: '2026-11-26T12:00:00Z',
  last_error: '',
  phone_number_id: 'telnyx_line',
};

function fakeDb(rows) {
  const updates = [];
  const rpcs = [];
  const from = (table) => {
    let values = null;
    const chain = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === 'then') {
            if (values) updates.push({ table, values });
            const data = values ? null : (rows[table] ?? null);
            return (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject);
          }
          if (prop === 'update') return (v) => ((values = v), chain);
          return () => chain;
        },
      }
    );
    return chain;
  };
  const rpc = async (name, args) => (rpcs.push({ name, args }), { data: null, error: null });
  return { from, rpc, updates, rpcs };
}

const agentJson = (config) => ({ ok: true, status: 200, json: async () => config });

// Empty automatic first message: the person always speaks first, same rule as tourism.
test('the US first message is empty and the opening states who Anna is and where she calls from', () => {
  assert.equal(US_FIRST_MESSAGE, '');
  assert.equal(
    usAgentConfig('Alejandro', ROUTE, 'voice').conversation_config.agent.first_message,
    ''
  );
  const prompt = usPrompt();
  // Anna says she is an AI in the first sentence, in Spanish and in English.
  assert.match(prompt, /soy Anna, asistente virtual con inteligencia artificial de Professional Latino Workers; les llamo desde Los Ángeles/);
  assert.match(prompt, /this is Anna, an AI virtual assistant with Professional Latino Workers/);
  assert.ok(prompt.includes(PLW_US_ADDRESS), 'the LA office address is in the prompt');
  assert.match(prompt, /ESTADOS UNIDOS/);
});

// Language rule: never assume from the menu or surname; English if answered in English,
// one bilingual offer when ambiguous, instant switch on request, context kept.
test('the US prompt handles the English menu and the Spanish human without assuming a language', () => {
  const prompt = usPrompt();
  assert.match(prompt, /NO asume el idioma de la persona por el menú/);
  assert.match(prompt, /Si la persona contesta en inglés, hable en inglés/);
  assert.match(prompt, /ofrezca UNA sola vez los dos idiomas/);
  assert.match(prompt, /no repita la presentación ni el motivo de la llamada/);
  assert.match(prompt, /entiéndalas y marque la opción correcta con el teclado/);
  assert.match(prompt, /Espere en silencio mientras suena música o grabaciones/);
  assert.match(prompt, /responda en inglés con una o dos palabras/);
  assert.match(prompt, /no presente nada: cuelgue sin pitch/);
  // Switching to Spanish and back keeps context.
  assert.ok(prompt.indexOf('cambie con ella y siga el tema') < prompt.indexOf('Nunca invente precios'));
});

test('the US verifier self-check passes and catches drift', () => {
  const healthy = usAgentConfig('Alejandro', ROUTE, 'voice');
  healthy.agent_id = 'us_agent';
  assert.deepEqual(usConfigFailures(healthy, ROUTE), []);
  for (const [failure, drift] of [
    ['first_message', (c) => (c.conversation_config.agent.first_message = 'Hola')],
    ['timezone', (c) => (c.conversation_config.agent.prompt.timezone = 'America/Costa_Rica')],
    ['skip_turn', (c) => delete c.conversation_config.agent.prompt.built_in_tools.skip_turn],
    ['keypad', (c) => delete c.conversation_config.agent.prompt.built_in_tools.play_keypad_touch_tone],
    ['expressive_mode', (c) => (c.conversation_config.tts.expressive_mode = true)],
  ]) {
    const config = structuredClone(healthy);
    drift(config);
    assert.deepEqual(usConfigFailures(config, ROUTE), [failure]);
  }
  // Anna transfers to the team line by phone number; a different number is drift.
  const transfer = healthy.conversation_config.agent.prompt.built_in_tools.transfer_to_number.params.transfers[0];
  assert.deepEqual(transfer.transfer_destination, { type: 'phone', phone_number: ROUTE.transfer_uri });
  assert.equal(transfer.transfer_type, 'sip_refer');
  const config = structuredClone(healthy);
  config.conversation_config.agent.prompt.built_in_tools.transfer_to_number.params.transfers[0].transfer_destination.phone_number = '+13055550000';
  assert.deepEqual(usConfigFailures(config, ROUTE), ['transfer_destination']);
});

// US phones are dialed as full E.164; no slice(-8) anywhere; DNC is checked before dialing.
test('a US call dials the full E.164 number, passes the LA office and skips blocked numbers', async () => {
  const db = fakeDb({
    us_dialer_runtime: { ...RUNTIME, paused: true },
    ai_outbound_settings: { caller_phone_number_id: 'line' },
    ai_outbound_do_not_call: [{ phone: '+13055551234' }],
  });
  const sent = [];
  const fetchImpl = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ success: true, conversation_id: 'conv_1' }) };
  };
  // Paused cancels real reservations before dialing.
  await dispatchUsCall(db, 'key', { call: { id: 'call-2', is_test: false, phone: '+13055551234' }, lead: {} }, () => {
    throw new Error('must not dial');
  });
  assert.equal(db.updates.at(-1).values.state, 'cancelled');
  // Blocked numbers are cancelled, never dialed.
  const openDb = fakeDb({
    us_dialer_runtime: RUNTIME,
    ai_outbound_settings: { caller_phone_number_id: 'line' },
    ai_outbound_do_not_call: [{ phone: '+13055551234' }],
  });
  await dispatchUsCall(openDb, 'key', { call: { id: 'call-3', is_test: false, phone: '+13055551234' }, lead: {} }, () => {
    throw new Error('must not dial blocked');
  });
  assert.equal(openDb.updates.at(-1).values.state, 'cancelled');
  // A test call dials the full E.164 with the LA office variable.
  await dispatchUsCall(
    fakeDb({ us_dialer_runtime: { ...RUNTIME, paused: true }, ai_outbound_settings: { caller_phone_number_id: 'cr_line' } }),
    'key',
    { call: { id: 'call-1', is_test: true, phone: '+13055551234', provider_agent_id: 'us_agent' }, lead: { business_name: 'Restaurante La Fe' } },
    fetchImpl
  );
  assert.equal(sent[0].to_number, '+13055551234');
  assert.equal(sent[0].agent_phone_number_id, 'telnyx_line', 'the Telnyx number, never the Costa Rica line');
  // Without the Telnyx number in ElevenLabs nothing is dialed.
  const noLine = fakeDb({ us_dialer_runtime: { ...RUNTIME, phone_number_id: null } });
  await dispatchUsCall(noLine, 'key', { call: { id: 'call-4', is_test: true, phone: '+13055551234' }, lead: {} }, () => {
    throw new Error('must not dial without the US line');
  });
  assert.equal(noLine.updates.at(-1).values.state, 'cancelled');
  assert.equal(sent[0].conversation_initiation_client_data.dynamic_variables.plw_office, PLW_US_ADDRESS);
  assert.equal(sent[0].conversation_initiation_client_data.dynamic_variables.plw_script_version, US_SCRIPT_VERSION);
  const source = await (await import('node:fs/promises')).readFile(
    new URL('../../supabase/functions/us-dialer/runner.js', import.meta.url), 'utf8'
  );
  assert.ok(!source.includes('slice(-8)'), 'no last-8 slicing in the US flow');
});

test('a finished US call syncs results and hands the agreed callback to Alejandro, never to Anna', async () => {
  const db = fakeDb({
    us_calls: [{ id: 'call-1', lead_id: 'lead-1', conversation_id: 'conv_1', provider_agent_id: 'us_agent', phone: '+13055551234', is_test: false, error: '' }],
    us_leads: [{ id: 'lead-1', timezone: 'America/Chicago' }],
    us_dialer_runtime: RUNTIME,
  });
  const order = [];
  const { from, rpc } = db;
  db.from = (table) => (order.push(`from:${table}`), from(table));
  db.rpc = (name, args) => (order.push(`rpc:${name}`), rpc(name, args));
  const value = (v) => ({ value: v });
  const conversation = {
    agent_id: 'us_agent',
    status: 'done',
    conversation_initiation_client_data: { dynamic_variables: { plw_us_call_id: 'call-1' } },
    analysis: {
      data_collection_results: {
        plw_outcome: value('INTERESTED_FOLLOW_UP'),
        plw_language: value('en'),
        plw_callback_date: value('2026-12-01'),
        plw_callback_clock: value('14:30'),
        plw_callback_confirmed: value('true'),
      },
    },
  };
  await syncUsCalls(db, 'key', async () => agentJson(conversation));
  // The agreed time becomes Alejandro's follow-up inside us_call_to_customer; Anna books nothing.
  assert.ok(!order.includes('from:us_callbacks'), 'no AI redial is scheduled');
  assert.deepEqual(db.updates.find((u) => u.table === 'us_calls' && u.values.details)?.values.details, {
    language: 'en', callback_date: '2026-12-01', callback_clock: '14:30', callback_confirmed: 'true',
  });
  const customerAt = order.indexOf('rpc:us_call_to_customer');
  assert.ok(customerAt >= 0, 'the interested call became a customer for Alejandro');
  // us_call_to_customer only converts calls that reached a person.
  const outcome = db.updates.find((u) => u.table === 'us_calls' && u.values.outcome);
  assert.equal(outcome?.values.ended_reason, 'human');
  assert.ok(!order.includes('prospects'), 'no direct prospects read: the service role has no grant');
});

// An unconfirmed callback suggestion never books a slot.
test('an unconfirmed callback suggestion does not book anything', async () => {
  const db = fakeDb({
    us_calls: [{ id: 'call-1', lead_id: 'lead-1', conversation_id: 'conv_1', provider_agent_id: 'us_agent', phone: '+13055551234', is_test: false, error: '' }],
    us_leads: [{ id: 'lead-1', timezone: 'America/Chicago' }],
    us_dialer_runtime: RUNTIME,
  });
  const value = (v) => ({ value: v });
  const conversation = {
    agent_id: 'us_agent',
    status: 'done',
    conversation_initiation_client_data: { dynamic_variables: { plw_us_call_id: 'call-1' } },
    analysis: {
      data_collection_results: {
        plw_outcome: value('CALLBACK_REQUESTED'),
        plw_callback_date: value('2026-12-01'),
        plw_callback_clock: value('14:30'),
        plw_callback_confirmed: value('false'),
      },
    },
  };
  await syncUsCalls(db, 'key', async () => agentJson(conversation));
  assert.ok(!db.rpcs.some((r) => r.name === 'us_local_to_utc'), 'no slot resolved without a confirmed day+time');
});

// Provider outage skips the tick but keeps the verified agent; drift un-verifies it.
test('an ElevenLabs outage skips the US tick; drift un-verifies but keeps the agent id', async () => {
  for (const fetchImpl of [async () => ({ ok: false, status: 503, json: async () => null }), async () => {
    throw new Error('network');
  }]) {
    const db = fakeDb({ us_dialer_runtime: RUNTIME, us_calls: [] });
    await runUsTick(db, 'key', fetchImpl);
    const runtimeWrites = db.updates.filter((u) => u.table === 'us_dialer_runtime').map((u) => u.values);
    assert.ok(runtimeWrites.some((v) => /se reintentará/.test(v.last_error ?? '')));
    assert.equal(db.rpcs.length, 0);
  }
  const drifted = usAgentConfig('Alejandro', ROUTE, 'voice');
  drifted.agent_id = 'us_agent';
  drifted.conversation_config.agent.prompt.prompt = 'Otro guion';
  const db = fakeDb({ us_dialer_runtime: RUNTIME, us_calls: [] });
  await runUsTick(db, 'key', async () => agentJson(drifted));
  const write = db.updates.find((u) => 'config_verified_at' in u.values).values;
  assert.equal(write.config_verified_at, null);
  assert.ok(!('provider_agent_id' in write));
});

test('a verified voice claims through claim_us_call, and paused blocks the claim', async () => {
  const healthy = usAgentConfig('Alejandro', ROUTE, 'voice');
  healthy.agent_id = 'us_agent';
  const db = fakeDb({ us_dialer_runtime: RUNTIME, us_calls: [] });
  await runUsTick(db, 'key', async () => agentJson(healthy));
  assert.ok(db.rpcs.some((r) => r.name === 'claim_us_call'));
  const pausedDb = fakeDb({ us_dialer_runtime: { ...RUNTIME, paused: true }, us_calls: [] });
  await runUsTick(pausedDb, 'key', async () => agentJson(healthy));
  assert.equal(pausedDb.rpcs.filter((r) => r.name === 'claim_us_call').length, 0);
  assert.equal(isPaused({ paused: true }), true);
  assert.equal(isPaused({ paused: false }), false);
});

test('US phone normalization takes full NANP numbers only', () => {
  assert.equal(normalizeUsPhone('305 555 1234'), '+13055551234');
  assert.equal(normalizeUsPhone('+1 (305) 555-1234'), '+13055551234');
  assert.equal(normalizeUsPhone('1-305-555-1234'), '+13055551234');
  assert.equal(normalizeUsPhone('1305551234'), null, '9 digits is not a US number');
  assert.equal(normalizeUsPhone('0305551234'), null, 'area starting 0 is invalid');
  // 11 digits starting with 1 are read as country code + 10: "13055512340" is then the
  // valid NANP number 305-551-2340, so E.164 stays well-formed either way.
  assert.equal(normalizeUsPhone('13055512340'), '+13055512340');
  assert.equal(looksLikeUsWithCountryCode('1 305 555 1234'), true, 'the country-code form is recognized');
  assert.equal(looksLikeUsWithCountryCode('3055551234'), false);
  assert.equal(normalizeUsPhone('88887777'), null, 'a CR number is not a US number');
  assert.equal(normalizeUsPhone(''), null);
  assert.equal(normalizeUsPhone(null), null);
});

test('speech-to-text gets the business name and bilingual email words, at most 50', () => {
  const keywords = usAsrKeywords('Restaurante La Fiesta');
  for (const word of ['Restaurante La Fiesta', 'Restaurante', 'Fiesta', 'arroba', 'dot com', 'gmail'])
    assert.ok(keywords.includes(word), word);
  assert.ok(!keywords.includes('La'), 'short words add noise');
  assert.ok(usAsrKeywords('x '.repeat(200)).length <= 50);
  const config = usAgentConfig('Alejandro', ROUTE, 'voice');
  assert.equal(config.platform_settings.overrides.conversation_config_override.asr.keywords, true);
});

// Configurar finds the Telnyx number in ElevenLabs however it was typed at import.
test('the US number is found in the ElevenLabs list in any format', () => {
  const list = [
    { phone_number: '+50640106198', phone_number_id: 'cr_line' },
    { phone_number: '+1 (213) 555-0100', phone_number_id: 'telnyx_line' },
  ];
  assert.equal(findPhoneNumberId(list, '+12135550100'), 'telnyx_line');
  assert.equal(findPhoneNumberId(list, '+13055550100'), null);
  assert.equal(findPhoneNumberId(null, '+12135550100'), null);
});
