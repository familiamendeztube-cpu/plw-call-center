import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatchTourismCall,
  isPaused,
  runTourismTick,
  syncTourismCalls,
} from '../../supabase/functions/tourism-dialer/runner.js';
import { tourismAgentConfig, tourismAsrKeywords, tourismConfigFailures, normalizeTourismPhone } from '../../supabase/functions/tourism-dialer/provider.js';
import {
  TOURISM_SCRIPT_VERSION,
  TOURISM_TOUR_QUESTION,
  TOURISM_HOTEL_QUESTION,
  TOURISM_GENERIC_QUESTION,
  afterHoursQuestionFor,
  tourismPrompt,
} from '../../supabase/functions/tourism-dialer/tourismScript.js';

const ROUTE = { provider_agent_id: 'tourism_agent', transfer_uri: 'sip:agent-2@phone.example.com' };
const RUNTIME = {
  ...ROUTE,
  scheduler_ready: true,
  paused: false,
  config_verified_at: '2026-11-19T12:00:00Z',
  last_error: '',
};

// Minimal stand-in for the supabase-js builder: every chain resolves to the table's rows,
// and update() calls are recorded so the test can see what the runner wrote.
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

test('a finished call creates the customer before its milestones look for it', async () => {
  const db = fakeDb({
    tourism_calls: [{ id: 'call-1', conversation_id: 'conv_1', provider_agent_id: 'tourism_agent', lead_id: 'lead-1', staff_id: 'agent-2', phone: '22221100' }],
    prospects: { id: 'prospect-1' },
    tourism_dialer_runtime: RUNTIME,
  });
  const order = [];
  const { from, rpc } = db;
  db.from = (table) => (order.push(table), from(table));
  db.rpc = (name, args) => (order.push(name), rpc(name, args));
  const value = (v) => ({ value: v });
  const conversation = {
    agent_id: 'tourism_agent',
    status: 'done',
    conversation_initiation_client_data: { dynamic_variables: { plw_tourism_call_id: 'call-1' } },
    analysis: {
      data_collection_results: {
        plw_outcome: value('DEMO_SCHEDULED'),
        plw_callback_date: value('2026-11-25'),
        plw_callback_clock: value('10:00'),
        plw_demo_date: value('2026-11-26'),
        plw_demo_clock: value('14:00'),
      },
    },
  };
  await syncTourismCalls(db, 'key', async () => agentJson(conversation));
  const customer = order.indexOf('tourism_call_to_customer');
  assert.ok(customer >= 0, 'customer conversion ran');
  assert.ok(customer < order.indexOf('tourism_hand_promise_to_agent'), 'promise hand-off after the customer');
  assert.ok(!order.includes('prospects'), 'no direct prospects read: the service role has no grant');
  assert.ok(customer < order.indexOf('record_tourism_demo_agreement'), 'demo milestone after the customer');
});

test('an admin test call has no lead and still dials while the dialer is paused', async () => {
  const db = fakeDb({
    tourism_dialer_runtime: { ...RUNTIME, paused: true },
    ai_outbound_settings: { caller_phone_number_id: 'line' },
  });
  let sent;
  const fetchImpl = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ success: true, conversation_id: 'conv_1' }) };
  };
  await dispatchTourismCall(db, 'key', { call: { id: 'call-1', is_test: true, phone: '22221100', provider_agent_id: 'tourism_agent' } }, fetchImpl);
  assert.equal(sent.to_number, '+50622221100');
  assert.equal(sent.conversation_initiation_client_data.dynamic_variables.business_name, 'el negocio de turismo');
  assert.deepEqual(db.updates.at(-1).values, { state: 'started', conversation_id: 'conv_1' });
  assert.ok(sent.conversation_initiation_client_data.conversation_config_override.asr.keywords.includes('arroba'));
});

test('each call boosts speech-to-text with the business name and email words, at most 50', () => {
  const keywords = tourismAsrKeywords('Le Cameleon  Boutique Hotel');
  for (const word of ['Le Cameleon Boutique Hotel', 'Cameleon', 'Boutique', 'arroba', 'punto com', 'dirección comercial'])
    assert.ok(keywords.includes(word), word);
  assert.ok(!keywords.includes('Le'), 'short words add noise');
  assert.ok(tourismAsrKeywords('x '.repeat(200)).length <= 50);
  // The agent must allow the per-call override, or ElevenLabs silently drops the keywords.
  const config = tourismAgentConfig('Alejandro', ROUTE, 'voice');
  assert.equal(config.platform_settings.overrides.conversation_config_override.asr.keywords, true);
});

test('a paused dialer cancels a real reservation before anything is dialed', async () => {
  const db = fakeDb({ tourism_dialer_runtime: { ...RUNTIME, paused: true } });
  await dispatchTourismCall(db, 'key', { call: { id: 'call-2', is_test: false, phone: '22221100' }, lead: {} }, () => {
    throw new Error('must not dial');
  });
  assert.equal(db.updates.at(-1).values.state, 'cancelled');
});

test('an ElevenLabs outage skips the tick but keeps the verified agent', async () => {
  for (const fetchImpl of [async () => ({ ok: false, status: 503, json: async () => null }), async () => {
    throw new Error('network');
  }]) {
    const db = fakeDb({ tourism_dialer_runtime: RUNTIME, tourism_calls: [] });
    await runTourismTick(db, 'key', fetchImpl);
    const runtimeWrites = db.updates.filter((u) => u.table === 'tourism_dialer_runtime').map((u) => u.values);
    assert.ok(runtimeWrites.some((v) => /se reintentará/.test(v.last_error ?? '')));
    assert.ok(runtimeWrites.every((v) => !('provider_agent_id' in v) && !('config_verified_at' in v)));
    assert.equal(db.rpcs.length, 0); // nothing claimed
  }
});

test('real drift un-verifies the voice but keeps the agent id so Reconfigurar patches it', async () => {
  const drifted = tourismAgentConfig('Alejandro', ROUTE, 'voice');
  drifted.agent_id = 'tourism_agent';
  drifted.conversation_config.agent.first_message = 'Otro saludo';
  const db = fakeDb({ tourism_dialer_runtime: RUNTIME, tourism_calls: [] });
  await runTourismTick(db, 'key', async () => agentJson(drifted));
  const write = db.updates.find((u) => 'config_verified_at' in u.values).values;
  assert.equal(write.config_verified_at, null);
  assert.match(write.last_error, /first_message/);
  assert.ok(!('provider_agent_id' in write));
  assert.equal(db.rpcs.length, 0);
});

// Calls of 2026-11-20: Anna narrated every wait on menus and holds, and [slow] tags dragged her
// speech. Losing any of these settings must stop the dialer until Reconfigurar.
test('the verifier requires silent waits, menu keys and no expressive tags', () => {
  const healthy = tourismAgentConfig('Alejandro', ROUTE, 'voice');
  healthy.agent_id = 'tourism_agent';
  assert.deepEqual(tourismConfigFailures(healthy, ROUTE), []);
  const prompt = healthy.conversation_config.agent.prompt.prompt;
  assert.equal(prompt.match(/BUZÓN DE VOZ/g).length, 1); // one voicemail rule, not two that disagree
  assert.doesNotMatch(prompt, /\{\{plw_transfer_uri\}\}/);
  for (const [failure, drift] of [
    ['skip_turn', (c) => delete c.conversation_config.agent.prompt.built_in_tools.skip_turn],
    ['keypad', (c) => delete c.conversation_config.agent.prompt.built_in_tools.play_keypad_touch_tone],
    ['expressive_mode', (c) => delete c.conversation_config.tts.expressive_mode],
  ]) {
    const config = structuredClone(healthy);
    drift(config);
    assert.deepEqual(tourismConfigFailures(config, ROUTE), [failure]);
  }
});

test('a verified voice claims, and the pre-migration pause marker still counts as paused', async () => {
  const healthy = tourismAgentConfig('Alejandro', ROUTE, 'voice');
  healthy.agent_id = 'tourism_agent';
  const db = fakeDb({ tourism_dialer_runtime: RUNTIME, tourism_calls: [] });
  await runTourismTick(db, 'key', async () => agentJson(healthy));
  assert.ok(db.rpcs.some((r) => r.name === 'claim_tourism_call'));

  assert.equal(isPaused({ last_error: 'scheduler_paused' }), true); // column not there yet
  assert.equal(isPaused({ paused: false, last_error: '' }), false);
  const legacy = fakeDb({ tourism_dialer_runtime: { ...RUNTIME, paused: undefined, last_error: 'scheduler_paused' }, tourism_calls: [] });
  await runTourismTick(legacy, 'key', async () => agentJson(healthy));
  assert.equal(legacy.rpcs.length, 0);
  assert.ok(legacy.updates.every((u) => u.values.last_error === undefined)); // marker never wiped
});

// The 2026-11-20 test-call rejection ("Revise el teléfono y la solicitud") merged two different
// failures; the normalization now accepts every valid CR typing and stays test-side pinable.
test('tourism phone normalization takes the last valid 8-digit CR group', () => {
  assert.equal(normalizeTourismPhone('70040079'), '70040079');
  assert.equal(normalizeTourismPhone('+506 7004 0079'), '70040079');
  assert.equal(normalizeTourismPhone('(506) 7004-0079'), '70040079');
  assert.equal(normalizeTourismPhone('070040079'), '70040079'); // leading zero typed by hand
  assert.equal(normalizeTourismPhone('50670040079'), '70040079'); // doubled country code
  assert.equal(normalizeTourismPhone('22221100'), '22221100'); // landline range stays valid
  assert.equal(normalizeTourismPhone('12345'), null);
  assert.equal(normalizeTourismPhone('12345678901234'), null);
  assert.equal(normalizeTourismPhone(''), null);
  assert.equal(normalizeTourismPhone(null), null);
});

// Ana Turismo only: material fulfillment + the single Alejandro ask, shared by the campaign
// and the admin test call because both use tourismAgentConfig.
test('the tourism prompt fulfills email/WhatsApp and asks about Alejandro exactly once', () => {
  const prompt = tourismPrompt();
  assert.ok(prompt.includes('Alejandro se lo explique directamente'));
  assert.ok(prompt.includes('Máximo dos intentos en total por correo'));
  assert.match(prompt, /Nunca digas que ya se envió nada/);
  assert.match(prompt, /lunes a viernes, de ocho de la mañana a cuatro de la tarde/);
  assert.match(prompt, /fecha y hora confirmadas/);
  assert.match(prompt, /no insistas, agradece y termina/);
  assert.match(prompt, /una sola vez por llamada/);
  // Version bumped with the prompt so the live verifier's prompt_base check passes.
  const config = tourismAgentConfig('Alejandro', ROUTE, 'voice');
  config.agent_id = 'tourism_agent';
  assert.deepEqual(tourismConfigFailures(config, ROUTE), []);
  assert.ok(TOURISM_SCRIPT_VERSION.endsWith('turismo-g'));
  // The 2026-11-23 failures, one rule each: hold phrasing, menu vs wrong number, the
  // email that starts with plain words, and no second Alejandro invitation.
  assert.match(prompt, /"le quedo un minuto"/);
  assert.match(prompt, /Un menú nunca es un número equivocado/);
  assert.match(prompt, /Conserva ambas palabras/);
  assert.match(prompt, /nunca vuelvas a hacer la invitación/);
  assert.match(prompt, /Nunca pidas el mismo dato una tercera vez/);
  // The verbatim opening questions appear once each, before any demo offer, and never assume
  // a destination like Arenal.
  const promptText = tourismPrompt();
  for (const question of [TOURISM_TOUR_QUESTION, TOURISM_HOTEL_QUESTION, TOURISM_GENERIC_QUESTION])
    assert.equal(promptText.split(question).length - 1, 1, 'the opening question appears once');
  assert.ok(
    promptText.indexOf(TOURISM_TOUR_QUESTION) < promptText.indexOf('demostración corta'),
    'open with the question before offering anything'
  );
  assert.match(promptText, /Nunca asumas que ofrecen un destino o actividad específica como Arenal/);
});

// The pitch opens with ONE real-world question picked by reliable business type; mixed or
// unknown types get the generic after-hours question, never a tour by default.
test('the opening question follows the lead business type, generic when unclear', () => {
  assert.equal(afterHoursQuestionFor('Operador de tours y aventura'), TOURISM_TOUR_QUESTION);
  assert.equal(afterHoursQuestionFor('TOURS'), TOURISM_TOUR_QUESTION);
  assert.equal(afterHoursQuestionFor('Rafting y canopy'), TOURISM_TOUR_QUESTION);
  assert.equal(afterHoursQuestionFor('Hotel boutique'), TOURISM_HOTEL_QUESTION);
  assert.equal(afterHoursQuestionFor('Cabinas y hospedaje'), TOURISM_HOTEL_QUESTION);
  assert.equal(afterHoursQuestionFor('Hostal céntrico'), TOURISM_HOTEL_QUESTION);
  assert.equal(afterHoursQuestionFor('Tour y hotel'), TOURISM_GENERIC_QUESTION, 'mixed type stays generic');
  assert.equal(afterHoursQuestionFor('Turismo'), TOURISM_GENERIC_QUESTION, 'plain turismo is not a pick');
  assert.equal(afterHoursQuestionFor(''), TOURISM_GENERIC_QUESTION);
  assert.equal(afterHoursQuestionFor(null), TOURISM_GENERIC_QUESTION);
  // Context beats the label: a business mixing both kinds stays generic.
  assert.equal(afterHoursQuestionFor('Agencia de tours con cabins'), TOURISM_GENERIC_QUESTION, 'both kinds stay generic');
  // Every question is one real after-hours scenario, never a management ask.
  for (const q of [TOURISM_TOUR_QUESTION, TOURISM_HOTEL_QUESTION, TOURISM_GENERIC_QUESTION])
    assert.ok(q.includes('¿cómo lo atienden ustedes?'));
});

// The verbatim questions reach ElevenLabs: campaign leads pass business_type into the init,
// and the test/default init falls back to 'unknown'.
test('dispatch passes the lead business type as a dynamic variable, unknown by default', async () => {
  const db = fakeDb({
    tourism_dialer_runtime: { ...RUNTIME, paused: true },
    ai_outbound_settings: { caller_phone_number_id: 'line' },
  });
  const sent = [];
  const fetchImpl = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ success: true, conversation_id: 'conv_1' }) };
  };
  await dispatchTourismCall(
    db, 'key',
    { call: { id: 'call-1', is_test: true, phone: '22221100', provider_agent_id: 'tourism_agent' }, lead: { business_name: 'Hotel Vela', business_type: 'Hotel y hospedaje' } },
    fetchImpl
  );
  await dispatchTourismCall(
    db, 'key',
    { call: { id: 'call-2', is_test: true, phone: '22221100', provider_agent_id: 'tourism_agent' }, lead: { business_name: 'Hotel Vela' } },
    fetchImpl
  );
  const variables = sent.map((body) => body.conversation_initiation_client_data.dynamic_variables);
  assert.equal(variables[0].business_type, 'Hotel y hospedaje');
  assert.equal(variables[1].business_type, 'unknown', 'missing type falls back to unknown');
  // The prompt tells Anna to pick by that variable and context, not by the label alone.
  const prompt = tourismPrompt();
  assert.ok(prompt.includes('{{business_type}}'));
  assert.match(prompt, /el contexto manda sobre la etiqueta/);
});
