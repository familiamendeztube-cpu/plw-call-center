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
  TOURISM_FIRST_MESSAGE,
  TOURISM_TOUR_STORY,
  TOURISM_HOTEL_STORY,
  TOURISM_GENERIC_STORY,
  storyFor,
  greetingFor,
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
  assert.equal(sent.conversation_initiation_client_data.dynamic_variables.historia, TOURISM_GENERIC_STORY);
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

// The story travels per lead by business type; mixed or unknown types get the generic story,
// never a tour by default, and dispatch passes it as a dynamic variable.
test('dispatch sends the story by business type, generic when unclear', async () => {
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
  assert.equal(variables[0].historia, TOURISM_HOTEL_STORY);
  assert.equal(variables[1].historia, TOURISM_GENERIC_STORY, 'missing type falls back to generic');
});

// The story constants and the word-based pick survive refactors; unknown or mixed stays generic.
test('the story follows the lead business type, generic when unclear', () => {
  assert.equal(storyFor('Operador de tours y aventura'), TOURISM_TOUR_STORY);
  assert.equal(storyFor('TOURS'), TOURISM_TOUR_STORY);
  assert.equal(storyFor('Rafting y canopy'), TOURISM_TOUR_STORY);
  assert.equal(storyFor('Hotel boutique'), TOURISM_HOTEL_STORY);
  assert.equal(storyFor('Cabinas y hospedaje'), TOURISM_HOTEL_STORY);
  assert.equal(storyFor('Hostal céntrico'), TOURISM_HOTEL_STORY);
  assert.equal(storyFor('Tour y hotel'), TOURISM_GENERIC_STORY, 'mixed type stays generic');
  assert.equal(storyFor('Turismo'), TOURISM_GENERIC_STORY, 'plain turismo is not a pick');
  assert.equal(storyFor(''), TOURISM_GENERIC_STORY);
  assert.equal(storyFor(null), TOURISM_GENERIC_STORY);
  assert.equal(storyFor('Agencia de tours con cabins'), TOURISM_GENERIC_STORY, 'both kinds stay generic');
  for (const story of [TOURISM_TOUR_STORY, TOURISM_HOTEL_STORY, TOURISM_GENERIC_STORY]) {
    assert.match(story, /otro (hotel|negocio|agencia)|otra agencia/, 'the other business answers first');
    assert.match(story, /confirme/, 'date and headcount left ready to confirm');
  }
});

// Ana Turismo only: material fulfillment + the single Alejandro ask, shared by the campaign
// and the admin test call because both use tourismAgentConfig.
test('the tourism prompt fulfills email/WhatsApp and asks about Alejandro exactly once', () => {
  const prompt = tourismPrompt();
  assert.ok(prompt.includes('Alejandro se lo explique directamente'));
  assert.ok(prompt.includes('Máximo dos intentos en total por correo'));
  assert.match(prompt, /Nunca digas que ya se envió nada/);
  assert.match(prompt, /lunes a viernes, de ocho de la mañana a cuatro de la tarde/);
  assert.match(prompt, /no insistas, agradece y termina/);
  assert.match(prompt, /una sola vez por llamada/i);
  // Version bumped with the prompt so the live verifier's prompt_base check passes.
  const config = tourismAgentConfig('Alejandro', ROUTE, 'voice');
  config.agent_id = 'tourism_agent';
  assert.deepEqual(tourismConfigFailures(config, ROUTE), []);
  assert.ok(TOURISM_SCRIPT_VERSION.endsWith('turismo-l'));
  // The 2026-11-23 failures, one rule each: hold phrasing, menu vs wrong number, the
  // email that starts with plain words, and no second Alejandro invitation.
  assert.match(prompt, /"le quedo un minuto"/);
  assert.match(prompt, /Un menú nunca es un número equivocado/);
  assert.match(prompt, /Conserva ambas palabras/);
  assert.match(prompt, /nunca vuelvas a hacer la invitación/i);
  assert.match(prompt, /Nunca pidas el mismo dato una tercera vez/);
  assert.match(prompt, /Nunca asumas que ofrecen un destino o actividad específica como Arenal/);
});

// The l call flow: empty automatic first message, greeting + ¿Cómo está? only, purpose FIRST
// on the next turn, at most ONE discovery question, and no re-verification after a sound check.
test('the opening greets, waits, explains purpose first and asks at most one question', () => {
  // The recipient always speaks first.
  assert.equal(TOURISM_FIRST_MESSAGE, '');
  assert.equal(
    tourismAgentConfig('Alejandro', ROUTE, 'voice').conversation_config.agent.first_message,
    ''
  );
  const prompt = tourismPrompt();
  assert.match(prompt, /di SOLO: «\{\{saludo\}\}\. Soy Ana, la asistente virtual de Professional Latino Workers\. ¿Cómo está\?»/);
  assert.match(prompt, /Espera de verdad su respuesta; no agregues nada más en ese turno/);
  assert.match(prompt, /Un "Aló", un "sí" o un "dígame" después del saludo son solo la persona comprobando la línea, no una respuesta ni un consentimiento: no verifiques nada de nuevo/);
  assert.match(prompt, /explica PRIMERO el propósito/);
  assert.match(prompt, /«Le cuento por qué le llamo\. Ofrecemos una recepcionista virtual para hoteles y empresas de turismo\. Atiende llamadas y mensajes de WhatsApp cuando el equipo está ocupado o ya terminó el turno\.»/);
  assert.match(prompt, /COMO MÁXIMO UNA pregunta de descubrimiento: «¿Quién atiende ustedes las consultas de reservas\?»/);
  assert.match(prompt, /sáltatela y no la repitas nunca/);
  assert.doesNotMatch(prompt, /¿Hablo con \{\{|presentationLineFor|¿Usted ve las consultas de reservas\?»\./);
  // The purpose always precedes the discovery question.
  assert.ok(prompt.indexOf('Le cuento por qué le llamo') < prompt.indexOf('¿Quién atiende ustedes las consultas de reservas?'));
  // Silence recovery never restarts the flow.
  assert.match(prompt, /sigue EXACTAMENTE donde ibas, sin repetir ni el saludo ni ninguna pregunta anterior/);
});

// The l reflection and shift question; day-off/sick only when they personally cover nights.
test('Ana reflects the receptionist answer and asks who covers after shift', () => {
  const prompt = tourismPrompt();
  assert.match(prompt, /«Ah, entonces usted conoce bien cómo entran esas consultas\?»|«Ah, entonces usted conoce bien cómo entran esas consultas\.»/);
  assert.match(prompt, /«¿Y después del turno, quién cubre esas consultas\?»/);
  assert.match(prompt, /Solo si la persona misma cubre las noches, pregunta cuando venga al caso quién cubre un día libre o una enfermedad/);
  // Coverage is workflow, never a refusal — the k rule survives.
  assert.match(prompt, /describe su flujo de trabajo: NUNCA es un no/);
  assert.match(prompt, /Solo un no expreso, un pedido de no llamar o un «solo por correo» cierran la llamada/);
});

// The l story ordering: gap reflection, then the tailored story from {{historia}}; full
// coverage gets the overflow, the who-speaks intro BEFORE the English example, then Spanish.
test('the story follows the gap, the example is introduced before it is spoken, no roleplay', () => {
  const prompt = tourismPrompt();
  assert.match(prompt, /«Entonces ese mensaje lo ve cuando vuelve en la mañana\.»/);
  assert.match(prompt, /la historia que encaja con su giro, tal como viene en \{\{historia\}\}/);
  // Full coverage: overflow first, who speaks to whom BEFORE the example, no role-play.
  assert.match(prompt, /«Imagine que hay dos llamadas a la vez, o un huésped en el mostrador mientras entra un WhatsApp en inglés\.»/);
  assert.match(prompt, /Presenta tú misma a la asistente y a quién le hablaría, ANTES del ejemplo/);
  assert.match(prompt, /«Por ejemplo, nuestra asistente le respondería a esa familia en inglés: "Good evening! I can check availability for tomorrow\. How many guests will be staying\?"»/);
  assert.match(prompt, /"Of course! How many people would like to join tomorrow's tour\?"»/);
  assert.match(prompt, /Vuelve al español enseguida y espera/);
  assert.doesNotMatch(prompt, /¿Quiere hacer de|invítala a preguntar/i);
  assert.match(prompt, /La persona nunca actúa ni responde como huésped/);
  // Short turns, no canned interrogation, no wall of speech, no automatic thank-and-close.
  assert.match(prompt, /nada de interrogatorios enlatados ni muros de discurso/);
  assert.doesNotMatch(prompt, /Si lo tienen todo cubierto, reconócelo, agradece y cierra/);
  assert.doesNotMatch(prompt, /Si después del ejemplo siguen diciendo que lo tienen todo cubierto, respeta su respuesta: agradece y cierra/);
  // The greeting is dynamic per call and the story variable is real.
  assert.ok(greetingFor().length > 0);
  assert.match(prompt, /\{\{historia\}\}/);
  // Never assume Arenal survived.
  assert.ok(prompt.includes('Nunca asumas que ofrecen un destino o actividad específica como Arenal'));
});

// The l value path: owner analysis only AFTER their workflow, "ya reservé" question, THEIR
// numbers, conditional ₡200,000, time saved without a price.
test('the analysis line comes only after their workflow and the numbers are theirs', () => {
  const prompt = tourismPrompt();
  assert.match(prompt, /Solo después de escuchar su flujo de trabajo puedes decir: «En las reservas que analizamos, la mitad empezó con una consulta fuera de horario o cuando el equipo estaba ocupado y nadie pudo contestar\.»/);
  assert.match(prompt, /nunca digas ni sugieras que revisamos los registros o reservas de su negocio/);
  assert.match(prompt, /«¿Le ha pasado que un cliente le contesta "ya reservé" cuando por fin lo llamaron\?»/);
  assert.doesNotMatch(prompt, /Supongamos que les llegan diez consultas por semana/);
  assert.match(prompt, /pregunta el valor promedio de una reserva y usa ese número, no uno inventado/);
  assert.match(prompt, /«Si la asistente rescata una reserva a la semana, en cuatro semanas serían cuatro reservas y doscientos mil colones brutos\.»/);
  assert.match(prompt, /Siempre queda claro que es condicional/);
  assert.match(prompt, /veinticinco minutos menos por semana/);
  assert.match(prompt, /o de una entrega más fácil/);
});

// The l confusion path: plain answer, FULL STOP, no invitation attached; Alejandro only after
// subsequent interest.
test('the confusion answer stops and never carries the invitation', () => {
  const prompt = tourismPrompt();
  assert.match(prompt, /«Vendemos un servicio de recepción virtual\. Podemos atender el teléfono y el WhatsApp de su negocio cuando ustedes lo necesiten\. Su equipo sigue decidiendo qué reservas confirma\.» No agregues la invitación de Alejandro en ese turno: para y espera/);
  assert.match(prompt, /Solo si después hay interés, presenta a Alejandro, el especialista, y haz UNA invitación a una llamada de cinco minutos/);
  // Single Alejandro invitation across the whole prompt.
  assert.equal(prompt.split('¿Le parece que Alejandro le llame para enseñarle ese ejemplo?').length - 1, 1);
  assert.match(prompt, /una llamada de cinco minutos/);
  // Preserved limits: email max twice, permission-gated callbacks, opt-outs.
  assert.match(prompt, /Máximo dos intentos en total por correo/);
  assert.match(prompt, /para llamar a ese número pide permiso específico/);
  assert.match(prompt, /Si piden que nunca más llames, reconoce la solicitud y termina/);
  assert.match(prompt, /9\. CIERRE/);
});

// The prompt still verifies clean at the exact l version.
test('the verifier accepts the l config and the version is l', () => {
  const config = tourismAgentConfig('Alejandro', ROUTE, 'voice');
  config.agent_id = 'tourism_agent';
  assert.deepEqual(tourismConfigFailures(config, ROUTE), []);
  assert.equal(TOURISM_SCRIPT_VERSION, 'anna-2026-11-24-turismo-l');
  assert.match(tourismPrompt(), /TURISMO/);
});
