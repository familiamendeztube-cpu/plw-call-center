import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './testDatabase.mjs';
import {
  DEMO_CLOSING,
  DEMO_FIRST_MESSAGE,
  DEMO_LIMITS,
  DEMO_NOTICE,
  DEMO_USED_UP,
  demoAgentConfig,
  demoPrompt,
  demoVariables,
} from '../../supabase/functions/plw-secretary-converse/demoAgent.ts';

// Live Secretaria IA demo: a real ElevenLabs agent, 3 conversations per customer, each
// capped at 10 questions (prompt) and 5 minutes (agent setting), PLW contact at the end.

const DRAFT = {
  business_name: 'Bosque de Bruma Tours',
  locale: 'Heredia',
  category: 'tours',
  services: ['Caminata al volcán', 'Tour de café'],
  highlight: '',
  description: 'Tours familiares en el bosque nuboso.',
  faqs: [{ question: '¿Incluye almuerzo?', answer: 'Sí, almuerzo típico.' }],
  facts: [{ label: 'Horario', value: '8 am a 5 pm' }],
  secretary_name: '',
  secretary_type: 'tourism',
};

const placeholders = (text) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);

test('every {{variable}} the agent uses is always supplied, even for an empty draft', () => {
  const used = new Set([...placeholders(demoPrompt()), ...placeholders(DEMO_FIRST_MESSAGE)]);
  for (const draft of [DRAFT, { business_name: 'X', services: null, faqs: 'nope', facts: [{}] }]) {
    const vars = demoVariables(draft);
    for (const name of used) assert.ok(vars[name], `${name} is supplied`);
    for (const value of Object.values(vars)) assert.ok(!/[{}]/.test(value), 'data never opens a {{variable}}');
  }
  const vars = demoVariables(DRAFT);
  assert.equal(vars.business_name, 'Bosque de Bruma Tours');
  assert.equal(vars.services, 'Caminata al volcán, Tour de café');
  assert.match(vars.faqs, /¿Incluye almuerzo\?: Sí, almuerzo típico\./);
  assert.equal(demoVariables({ business_name: 'Y' }).location, 'No indicado');
  // A car-shop draft with no saved secretary type still introduces itself correctly.
  assert.equal(demoVariables({ business_name: 'Taller', category: 'auto' }).business_type, 'taller o agencia de autos');
  assert.equal(demoVariables({ business_name: 'Y' }).business_type, 'servicios');
  // Text typed into the draft cannot smuggle a new variable or instruction block.
  assert.equal(demoVariables({ ...DRAFT, business_name: 'Tours {{faqs}}' }).business_name, 'Tours faqs');
});

test('the agent only starts with our token, stops at 5 minutes and closes with the PLW contact', () => {
  const config = demoAgentConfig('voice_123');
  assert.equal(config.platform_settings.auth.enable_auth, true);
  assert.equal(config.platform_settings.overrides, undefined, 'the page cannot override the prompt');
  assert.equal(config.conversation_config.conversation.max_duration_seconds, DEMO_LIMITS.minutes * 60);
  assert.equal(config.conversation_config.tts.voice_id, 'voice_123');
  const prompt = config.conversation_config.agent.prompt.prompt;
  assert.match(prompt, new RegExp(`hasta ${DEMO_LIMITS.questions} preguntas`));
  assert.ok(prompt.includes(DEMO_CLOSING));
  assert.ok(config.conversation_config.agent.prompt.built_in_tools.end_call);
  for (const text of [DEMO_CLOSING, DEMO_USED_UP]) assert.match(text, /4010-6198/);
  assert.match(DEMO_NOTICE, /3 conversaciones de hasta 10 preguntas/);
});

let db;
before(async () => {
  db = await createTestDatabase();
});
after(async () => {
  await db?.close();
});

test('each customer gets 3 demo conversations, counted per draft, server only', async () => {
  await db.transaction(async (tx) => {
    const draftFor = async (n) => {
      const prospect = `00000000-0000-0000-0000-00000000000${n}`;
      await tx.query(
        "INSERT INTO prospects (id, business_name, phone, owner_id) VALUES ($1, 'Tour', '88881234', 'agent-1')",
        [prospect]
      );
      return (
        await tx.query(
          `INSERT INTO prospect_site_drafts (prospect_id, site_slug, business_name, category, preview_token, created_by)
           VALUES ($1, 'plw-tourism-tours', 'Tour', 'tours', $2, 'agent-1') RETURNING id`,
          [prospect, String(n).repeat(48)]
        )
      ).rows[0].id;
    };
    const [first, second] = [await draftFor(1), await draftFor(2)];
    await tx.exec('SET LOCAL ROLE service_role');
    const claim = async (draft) =>
      (await tx.query('SELECT claim_secretary_demo_session($1, 3) AS c', [draft])).rows[0].c;

    assert.deepEqual([(await claim(first)).used, (await claim(first)).used, (await claim(first)).used], [1, 2, 3]);
    assert.deepEqual(await claim(first), { allowed: false, used: 3 });
    assert.equal((await claim(second)).allowed, true, 'another customer has their own 3');

    await tx.exec('RESET ROLE');
    await tx.exec('SET LOCAL ROLE authenticated');
    await tx.exec('SAVEPOINT browser');
    await assert.rejects(tx.query('SELECT claim_secretary_demo_session($1, 99)', [first]), /permission denied/);
    await tx.exec('ROLLBACK TO SAVEPOINT browser');
    await assert.rejects(tx.query('SELECT * FROM plw_secretary_demo_sessions'), /permission denied/);
    await tx.rollback();
  });
});
