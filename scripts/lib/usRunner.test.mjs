import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatchUsCall,
  isPaused,
  runUsTick,
  syncUsCalls,
} from '../../supabase/functions/us-dialer/runner.js';
import { businessNow, usAgentConfig, usAsrKeywords, usCallResults, usConfigFailures, normalizeUsPhone, looksLikeUsWithCountryCode, findPhoneNumberId } from '../../supabase/functions/us-dialer/provider.js';
import {
  US_SCRIPT_VERSION,
  US_FIRST_MESSAGE,
  usPrompt,
  PLW_US_ADDRESS,
} from '../../supabase/functions/us-dialer/usScript.js';

const ROUTE = { provider_agent_id: 'us_agent' };
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
test('the US first message is empty and the opening is short, human and asks permission first', () => {
  assert.equal(US_FIRST_MESSAGE, '');
  assert.equal(
    usAgentConfig('Alejandro', ROUTE).conversation_config.agent.first_message,
    ''
  );
  const prompt = usPrompt();
  // After the first live morning (everyone hung up on the old opening): the business's name, who
  // calls, permission; the working question only after a yes; no city, no "IA" in the first line.
  assert.ok(
    prompt.includes('"Buenos días, ¿hablo con {{business_name}}? Le habla Anna, asistente virtual de Professional Latino Workers. ¿Tiene un minutito?"')
  );
  assert.match(prompt, /Si le dice que sí o la deja seguir, haga UNA pregunta: "¿Quién le contesta el teléfono/);
  assert.match(prompt, /no diga de qué ciudad llama, no diga "inteligencia artificial"/);
  assert.match(prompt, /nunca diga "¿En qué le puedo ayudar\?"/);
  assert.ok(prompt.includes(PLW_US_ADDRESS), 'the LA office address is in the prompt');
  assert.match(prompt, /ESTADOS UNIDOS/);
});

// Language rule: never assume from the menu or surname; Spanish by default after a human,
// natural English switch without restarting, one bilingual offer when ambiguous, context kept.
test('the US prompt handles the English menu and the Spanish human without assuming a language', () => {
  const prompt = usPrompt();
  assert.match(prompt, /NO asume el idioma de la persona por el menú/);
  assert.match(prompt, /el español es el idioma por defecto/);
  assert.match(prompt, /siga en inglés de forma natural, sin reiniciar/);
  // "Aló" or "Bueno" is Spanish: she never asks which language (it lost the first live calls).
  assert.match(prompt, /"Aló", "Bueno", "Hola", "Diga", "¿Sí\?" o cualquier saludo en español: es español/);
  assert.match(prompt, /NUNCA pregunte "¿Habla español o inglés\?"/);
  assert.match(prompt, /entiéndalas y marque la opción correcta con el teclado/);
  assert.match(prompt, /Espere en silencio mientras suena música o grabaciones/);
  assert.match(prompt, /responda en inglés con una o dos palabras/);
  assert.match(prompt, /no presente nada: cuelgue sin pitch/);
  // The multilingual demo uses only provable voices and never promises every language.
  assert.match(prompt, /Gracias por llamar, ¿en qué le puedo ayudar\?/);
  assert.match(prompt, /Thanks for calling\. How can I help you\?/);
  assert.match(prompt, /您好，请问有什么可以帮您？/);
  assert.match(prompt, /No prometa "todos los idiomas"/);
});

test('the US verifier self-check passes and catches drift', () => {
  const healthy = usAgentConfig('Alejandro', ROUTE);
  healthy.agent_id = 'us_agent';
  assert.deepEqual(usConfigFailures(healthy, ROUTE), []);
  for (const [failure, drift] of [
    ['first_message', (c) => (c.conversation_config.agent.first_message = 'Hola')],
    ['timezone', (c) => (c.conversation_config.agent.prompt.timezone = 'America/Costa_Rica')],
    ['skip_turn', (c) => (c.conversation_config.agent.prompt.built_in_tools.skip_turn = undefined)],
    ['keypad', (c) => (c.conversation_config.agent.prompt.built_in_tools.play_keypad_touch_tone = undefined)],
    ['expressive_mode', (c) => (c.conversation_config.tts.expressive_mode = true)],
    // Owner's setup: Melissa in Spanish (default), Siren in English, GPT-6 Luna, Eleven v4 Turbo.
    ['voice_model', (c) => (c.conversation_config.tts.model_id = 'eleven_v3_conversational')],
    ['voice_spanish', (c) => (c.conversation_config.tts.voice_id = 'CRUQ4Y1bKyD8VqRkNh6V')],
    ['llm', (c) => (c.conversation_config.agent.prompt.llm = 'gemini-2.5-flash')],
    ['language_presets', (c) => (c.conversation_config.language_presets.en.overrides.tts.voice_id = 'kjHz50TasdqbpbfK4uaN')],
    ['language_presets', (c) => (c.conversation_config.language_presets.fr = { overrides: { agent: {} } })],
  ]) {
    const config = structuredClone(healthy);
    drift(config);
    assert.deepEqual(usConfigFailures(config, ROUTE), [failure]);
  }
  // No live transfers since 2026-11-27: a transfer tool on the agent is drift.
  const config = structuredClone(healthy);
  config.conversation_config.agent.prompt.built_in_tools.transfer_to_number = { type: 'system', name: 'transfer_to_number' };
  assert.deepEqual(usConfigFailures(config, ROUTE).sort(), ['extra_builtin_tool', 'transfer_removed']);
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
  assert.equal(sent[0].conversation_initiation_client_data.dynamic_variables.plw_transfer_uri, undefined, 'no transfer route in the US flow');
  assert.match(sent[0].conversation_initiation_client_data.dynamic_variables.business_now, /de 20\d\d/, 'Anna gets the business date');
  const source = await (await import('node:fs/promises')).readFile(
    new URL('../../supabase/functions/us-dialer/runner.js', import.meta.url), 'utf8'
  );
  assert.ok(!source.includes('slice(-8)'), 'no last-8 slicing in the US flow');
});

test('Anna hears the business clock, never UTC or the office clock', () => {
  const at = new Date('2026-11-26T21:30:00Z');
  assert.match(businessNow('America/New_York', at), /^jueves, 26 de noviembre de 2026, 4:30\sp\.\s?m\..*\(hora .*oriental\)$/);
  assert.match(businessNow('America/Los_Angeles', at), /1:30\sp\.\s?m\..*Pacífico/);
  assert.equal(businessNow('', at), businessNow('America/Los_Angeles', at), 'unknown zone: Pacific, like the callbacks');
  assert.equal(businessNow('Not/AZone', at), businessNow('America/Los_Angeles', at));
});

test('a guessed callback year is corrected from the call day', () => {
  const at = (date) =>
    usCallResults({ data_collection_results: { plw_callback_date: { value: date } } }, '2026-12-28').details.callback_date;
  assert.equal(at('2025-12-30'), '2026-12-30');
  assert.equal(at('2026-01-04'), '2027-01-04', 'early January after a late-December call is next year');
  assert.equal(at('2026-12-28'), '2026-12-28', 'today stays today');
  assert.equal(usCallResults({ data_collection_results: { plw_callback_date: { value: 'el martes' } } }, '2026-12-28').details.callback_date, 'el martes');
});

test('a finished US call syncs results and hands the agreed callback to Alejandro, never to Anna', async () => {
  const db = fakeDb({
    us_calls: [{ id: 'call-1', lead_id: 'lead-1', conversation_id: 'conv_1', provider_agent_id: 'us_agent', phone: '+13055551234', is_test: false, error: '', created_at: '2026-11-26T21:00:00Z' }],
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
        plw_callback_date: value('2025-12-01'), // the extraction guessed last year
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

// Owner rules 2026-11-27: fixed price spoken, trade examples, callback-only closing,
// honest AI disclosure, no live transfers.
test('the US prompt sells with a trade example, the fixed price and a 24-hour PLW callback', () => {
  const prompt = usPrompt();
  // One trade example per call, chosen by business type, short turns.
  assert.match(prompt, /Plomería: "Mientras usted arregla una fuga/);
  assert.match(prompt, /Taller: "Cuando usted está debajo de un carro/);
  assert.match(prompt, /Pintura: "Mientras pinta/);
  assert.match(prompt, /elija UNO según la actividad/);
  // Fixed price: 200 USD monthly, site design included, cancel anytime; no invented offers.
  assert.match(prompt, /200 dólares al mes, precio fijo/);
  assert.match(prompt, /valor estimado por PLW de 2,000 a 5,000 dólares/);
  assert.match(prompt, /cancelación cuando quiera/);
  assert.match(prompt, /No hay promociones temporales/);
  // The only closing: a PLW callback inside 24 hours, explicit interest and consent.
  assert.match(prompt, /DEVOLUCIÓN DE LLAMADA \(único cierre; nunca transfiera/);
  assert.match(prompt, /dentro de las próximas 24 horas/);
  assert.match(prompt, /No ofrezca conectar a nadie ahora mismo/);
  // Honest AI: never passes as human, discloses at the natural close.
  assert.match(prompt, /Nunca se haga pasar por humana/);
  assert.match(prompt, /Por cierto, soy una asistente de inteligencia artificial/);
  assert.match(prompt, /Yo contesto por usted, tomo los datos y le aviso por mensaje de texto/);
  // Confirmed appointment times only.
  assert.match(prompt, /solo dé lugar y hora como confirmados cuando de verdad lo estén/);
  // Owner rules 2026-11-27b: proactive selling on interest, no WhatsApp in the US market,
  // the exact AI-disclosure closing line, real date/time confirmations, no promised sends.
  assert.match(prompt, /venda de forma PROACTIVA en turnos cortos/);
  assert.ok(!/WhatsApp/i.test(prompt), 'no WhatsApp in the US sales flow');
  assert.match(prompt, /Así puedo contestar por su negocio/);
  assert.match(prompt, /nunca con un "hoy o mañana" suelto/);
  assert.match(prompt, /no prometa enviar nada ni diga que algo ya fue enviado/i);
  assert.match(prompt, /frase de muestra en mandarín/);
  assert.match(prompt, /No prometa "todos los idiomas" ni soporte completo en mandarín/);
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
  const drifted = usAgentConfig('Alejandro', ROUTE);
  drifted.agent_id = 'us_agent';
  drifted.conversation_config.agent.prompt.prompt = 'Otro guion';
  const db = fakeDb({ us_dialer_runtime: RUNTIME, us_calls: [] });
  await runUsTick(db, 'key', async () => agentJson(drifted));
  const write = db.updates.find((u) => 'config_verified_at' in u.values).values;
  assert.equal(write.config_verified_at, null);
  assert.ok(!('provider_agent_id' in write));
});

test('a verified voice claims through claim_us_call, and paused blocks the claim', async () => {
  const healthy = usAgentConfig('Alejandro', ROUTE);
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
  const config = usAgentConfig('Alejandro', ROUTE);
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
