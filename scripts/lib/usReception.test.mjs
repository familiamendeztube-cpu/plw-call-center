import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CR_RECEPTION_AGENT_ID,
  RECEPTION_FIELDS,
  ensureUsReception,
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

test('the US receptionist collects exactly what PLW reads, with the Costa Rica voice and webhook', () => {
  assert.equal(CR_RECEPTION_AGENT_ID, PLW_AGENT_ID, 'copies the receptionist the webhook already trusts');
  assert.deepEqual(Object.keys(RECEPTION_FIELDS).sort(), [...FIELD_IDS].sort());
  assert.equal(RECEPTION_FIELDS.callback_consent.type, 'boolean');

  const config = usReceptionConfig(CR_AGENT);
  const agent = config.conversation_config.agent;
  assert.deepEqual(config.conversation_config.tts, CR_AGENT.conversation_config.tts);
  assert.deepEqual(config.conversation_config.turn, { turn_timeout: 7 });
  assert.deepEqual(config.platform_settings.workspace_overrides.webhooks, { post_call_webhook_id: 'wh_plw', events: ['transcript'] });
  assert.equal(agent.prompt.llm, 'gemini-2.0-flash');
  assert.equal(agent.prompt.timezone, 'America/Los_Angeles');
  assert.match(agent.first_message, /Professional Latino Workers.*virtual assistant/);
  assert.match(agent.prompt.prompt, /ningún agente pudo atender/);
  assert.doesNotMatch(agent.prompt.prompt, /Costa Rica/);
  assert.deepEqual(Object.keys(agent.prompt.built_in_tools).sort(), ['end_call', 'language_detection']);
  assert.ok(config.conversation_config.language_presets.es, 'English and Spanish');
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
