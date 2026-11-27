import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CR_RECEPTION_AGENT_ID,
  RECEPTION_FIELDS,
  ensureUsReception,
  receptionPrompt,
  usReceptionConfig,
} from '../../supabase/functions/us-dialer/reception.js';
import { FIELD_IDS, PLW_AGENT_ID } from '../../supabase/functions/elevenlabs-webhook/rules.js';

const CR_AGENT = {
  agent_id: CR_RECEPTION_AGENT_ID,
  conversation_config: {
    tts: { voice_id: 'cr_voice', model_id: 'eleven_v3_conversational' },
    asr: { quality: 'high' },
    turn: { turn_timeout: 7 },
    agent: {
      language: 'es',
      first_message: 'Hola, PLW Costa Rica',
      prompt: { prompt: 'Costa Rica', llm: 'gemini-2.0-flash', temperature: 0.3, built_in_tools: { transfer_to_number: {} } },
    },
  },
  platform_settings: { workspace_overrides: { webhooks: { post_call_webhook_id: 'wh_plw', events: ['transcript'] } } },
};

test('the US receptionist collects exactly what PLW reads, with Anna\'s US voices and the Costa Rica webhook', () => {
  assert.equal(CR_RECEPTION_AGENT_ID, PLW_AGENT_ID, 'copies the receptionist the webhook already trusts');
  assert.deepEqual(Object.keys(RECEPTION_FIELDS).sort(), [...FIELD_IDS].sort());
  assert.equal(RECEPTION_FIELDS.callback_consent.type, 'boolean');

  const config = usReceptionConfig(CR_AGENT);
  const agent = config.conversation_config.agent;
  // Same as Anna: Spanish by default with Melissa, English with Siren, GPT-6 Luna, Eleven v4 Turbo.
  assert.deepEqual(config.conversation_config.tts, { voice_id: 'kjHz50TasdqbpbfK4uaN', model_id: 'eleven_v4_turbo' });
  assert.equal(agent.language, 'es');
  assert.deepEqual(config.conversation_config.language_presets, {
    en: { overrides: { agent: {}, tts: { voice_id: 'eXpIbVcVbLo8ZJQDlDnl' } } },
  });
  assert.equal(agent.prompt.llm, 'gpt-6-luna');
  assert.equal(agent.prompt.temperature, 0.3, 'speech tuning still comes from Costa Rica');
  assert.deepEqual(config.conversation_config.turn, { turn_timeout: 7 });
  assert.deepEqual(config.platform_settings.workspace_overrides.webhooks, { post_call_webhook_id: 'wh_plw', events: ['transcript'] });
  assert.equal(agent.prompt.timezone, 'America/Los_Angeles');
  // Owner's entry line (2026-11-27): why they call comes first, no language announcement.
  assert.equal(agent.first_message, 'Gracias por llamar a Professional Latino Workers. Soy Anna. ¿En qué le puedo ayudar?');
  assert.match(agent.prompt.prompt, /ningún agente pudo atender/);
  // Inbound priority: the reason for the call before any data collection; no live transfers.
  assert.match(agent.prompt.prompt, /Su prioridad es POR QUÉ llama/);
  assert.match(agent.prompt.prompt, /Nunca transfieras la llamada/);
  assert.doesNotMatch(agent.prompt.prompt, /Costa Rica/);
  assert.deepEqual(Object.keys(agent.prompt.built_in_tools).sort(), ['end_call', 'language_detection']);
  // Owner rules 2026-11-27b: proactive sale on interest, no WhatsApp, exact AI closing,
  // real date/time confirmations, Mandarin as a sample phrase only.
  const rp = receptionPrompt();
  assert.match(rp, /venda de forma proactiva en turnos cortos/);
  assert.ok(!/WhatsApp/i.test(rp), 'no WhatsApp in the US reception flow');
  assert.match(rp, /Así puedo contestar por su negocio/);
  assert.match(rp, /nunca con un "hoy o mañana" suelto/);
  assert.match(rp, /No prometas "todos los idiomas" ni soporte completo en mandarín/);
  assert.equal(RECEPTION_FIELDS.preferred_contact.description.includes('whatsapp'), false);
});

test('the receptionist is created once and updated in place after that', async () => {
  const sent = [];
  let saved = null;
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: saved }) }) }),
      upsert: async (row) => ((saved = { value: row.value }), { error: null }),
    }),
  };
  const fetchImpl = async (url, init) => {
    sent.push(`${init.method} ${url.replace('https://api.elevenlabs.io/v1/convai', '')}`);
    const body = url.endsWith(CR_RECEPTION_AGENT_ID) ? CR_AGENT : { agent_id: 'agent_us_reception' };
    return { ok: true, status: 200, json: async () => body };
  };
  const first = await ensureUsReception(db, 'key', fetchImpl);
  assert.equal(first.agent_id, 'agent_us_reception');
  assert.equal(first.webhook, 'copied from Costa Rica');
  assert.equal(saved.value.agent_id, 'agent_us_reception');
  await ensureUsReception(db, 'key', fetchImpl);
  assert.deepEqual(sent, [
    `GET /agents/${CR_RECEPTION_AGENT_ID}`,
    'POST /agents/create',
    `GET /agents/${CR_RECEPTION_AGENT_ID}`,
    'PATCH /agents/agent_us_reception',
  ]);
});

test('the US number gets PLW USA — Recepción: only the agent changes, and it is read back', async () => {
  const { assignUsReception } = await import('../../supabase/functions/us-dialer/reception.js');
  let assigned = { agent_id: 'agent_demo', agent_name: 'PLW USA — Demo' };
  const patches = [];
  const db = {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'settings'
              ? { data: { value: { agent_id: 'agent_reception' } } }
              : { data: { phone_number_id: 'phnum_us' } },
        }),
      }),
    }),
  };
  const fetchImpl = async (url, init) => {
    if (init.method === 'PATCH') {
      patches.push(JSON.parse(init.body));
      assigned = { agent_id: 'agent_reception', agent_name: 'PLW USA — Recepción' };
    }
    return { ok: true, status: 200, json: async () => ({ phone_number: '+17547991065', assigned_agent: assigned }) };
  };
  const result = await assignUsReception(db, 'key', fetchImpl);
  assert.deepEqual(patches, [{ agent_id: 'agent_reception' }], 'nothing but the agent is sent');
  assert.equal(result.changed, true);
  assert.equal(result.is_reception, true);
  assert.deepEqual(result.previous, { agent_id: 'agent_demo', agent_name: 'PLW USA — Demo' });
  assert.equal((await assignUsReception(db, 'key', fetchImpl)).changed, false, 'already set: no second change');
  assert.equal(patches.length, 1);
});
