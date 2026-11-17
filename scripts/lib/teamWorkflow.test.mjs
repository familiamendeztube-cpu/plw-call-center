import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './testDatabase.mjs';

// Migration 20261116120000: follow-up dates, agent-added customers, "en llamada", new agents,
// materials, the dialer audit and the email outbox scheduler.

const id = (number) => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;
const AGENT_1 = { staffId: 'agent-1', userId: id(101), sessionId: id(201) };
const AGENT_2 = { staffId: 'agent-2', userId: id(102), sessionId: id(202) };
const ADMIN = { staffId: 'admin-1', userId: id(109), sessionId: id(209) };
const CLIENT_OF_1 = id(1);

let db;

before(async () => {
  db = await createTestDatabase();
  for (const { staffId, userId, sessionId } of [AGENT_1, AGENT_2, ADMIN]) {
    await db.query('INSERT INTO auth.users (id) VALUES ($1)', [userId]);
    await db.query('INSERT INTO auth.sessions (id, user_id) VALUES ($1, $2)', [sessionId, userId]);
    await db.query(
      'UPDATE public.staff_profiles SET auth_user_id = $1, is_enabled = true WHERE id = $2',
      [userId, staffId]
    );
  }
  await db.query(
    `INSERT INTO public.prospects (id, business_name, phone, owner_id)
     VALUES ($1, 'Clínica Uno', '8888-1234', 'agent-1')`,
    [CLIENT_OF_1]
  );
});

after(async () => {
  await db?.close();
});

// Runs as the person (or as the scheduler when null) and rolls everything back.
async function as(person, work) {
  let result;
  await db.transaction(async (tx) => {
    const run = async (sql, params = []) => {
      await tx.exec('RESET ROLE');
      const claims = person ? { sub: person.userId, session_id: person.sessionId } : {};
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      if (person) await tx.exec('SET LOCAL ROLE authenticated');
      return (await tx.query(sql, params)).rows;
    };
    result = await work(run);
    await tx.rollback();
  });
  return result;
}

// A refused call aborts its transaction, so each one gets its own.
const refuses = (person, sql, pattern) =>
  assert.rejects(
    as(person, (run) => run(sql)),
    pattern
  );

const nextFollowUp = async (run) =>
  (await run('SELECT next_follow_up_at FROM public.prospects WHERE id = $1', [CLIENT_OF_1]))[0]
    .next_follow_up_at;

test('the next follow-up is the earliest one not done, and follows changes', async () => {
  await as(AGENT_1, async (run) => {
    const schedule = async (hours) =>
      (
        await run(
          `SELECT public.schedule_followup($1, 'callback', 'Llamar', now() + make_interval(hours => $2)) AS id`,
          [CLIENT_OF_1, hours]
        )
      )[0].id;
    const later = await schedule(48);
    const sooner = await schedule(2);
    const due = async (followupId) =>
      (await run('SELECT due_at FROM public.followups WHERE id = $1', [followupId]))[0].due_at;

    assert.deepEqual(await nextFollowUp(run), await due(sooner));
    await run('SELECT public.set_followup_completed($1, true)', [sooner]);
    assert.deepEqual(await nextFollowUp(run), await due(later));
    await run(`SELECT public.reschedule_followup($1, now() + interval '1 hour')`, [later]);
    assert.deepEqual(await nextFollowUp(run), await due(later));
    await run('SELECT public.set_followup_completed($1, true)', [later]);
    assert.equal(await nextFollowUp(run), null);
  });
});

test('moving a done follow-up brings it back as pending', async () => {
  await as(AGENT_1, async (run) => {
    const [{ id: followupId }] = await run(
      `SELECT public.schedule_followup($1, 'email', 'Escribir', now()) AS id`,
      [CLIENT_OF_1]
    );
    await run('SELECT public.set_followup_completed($1, true)', [followupId]);
    await run(`SELECT public.reschedule_followup($1, now() + interval '3 days')`, [followupId]);
    const [row] = await run('SELECT completed FROM public.followups WHERE id = $1', [followupId]);
    assert.equal(row.completed, false);
  });
});

test('an agent adds a customer of their own, once per number', async () => {
  await as(AGENT_2, async (run) => {
    const add = (phone) =>
      run(
        `SELECT public.agent_create_prospect('Pizzería Sol', 'Ana', '', $1, 'Restaurante', 'Pedidos') AS id`,
        [phone]
      );
    const [{ id: created }] = await add('7000 1111');
    const [prospect] = await run(
      'SELECT owner_id, source, stage FROM public.prospects WHERE id = $1',
      [created]
    );
    assert.deepEqual(prospect, { owner_id: 'agent-2', source: 'manual', stage: 'new' });
    const conversations = await run(
      'SELECT status FROM public.conversations WHERE prospect_id = $1',
      [created]
    );
    assert.deepEqual(conversations, [{ status: 'waiting_customer' }]);

    // The same number written another way is the same customer.
    const [{ id: again }] = await add('+506 7000-1111');
    assert.equal(again, created);
  });
});

test("an agent cannot take another agent's customer by adding the number", async () => {
  await refuses(
    AGENT_2,
    `SELECT public.agent_create_prospect('Otra', '', '', '88881234', '', '')`,
    /ya pertenece a otro cliente/
  );
});

test('adding a customer needs a name and a way to reach them, and an agent', async () => {
  await refuses(
    AGENT_2,
    `SELECT public.agent_create_prospect('Sin contacto', '', '', '', '', '')`,
    /teléfono o un correo/
  );
  await refuses(
    AGENT_2,
    `SELECT public.agent_create_prospect('Corto', '', '', '1234', '', '')`,
    /8 dígitos/
  );
  await refuses(
    ADMIN,
    `SELECT public.agent_create_prospect('Admin', '', 'a@b.cr', '', '', '')`,
    /No autorizado/
  );
});

test('the phone marks the agent as on a call, and only that', async () => {
  await refuses(AGENT_1, `SELECT public.set_operational_status('after_call')`, /no válido/);
  await as(AGENT_1, async (run) => {
    await run(`SELECT public.set_operational_status('in_call')`);
    await run('SELECT public.set_operational_status(NULL)');
    const rows = await run(`SELECT operational FROM public.staff_presence WHERE staff_id = 'agent-1'`);
    assert.deepEqual(rows, [{ operational: null }]);
  });
});

test('the administrator adds the next agent, disabled until it has a PIN', async () => {
  await as(ADMIN, async (run) => {
    const [{ id: agentId }] = await run(`SELECT public.admin_create_agent(' Laura ') AS id`);
    assert.equal(agentId, 'agent-4');
    const [profile] = await run(
      `SELECT display_name, is_enabled FROM public.staff_profiles WHERE id = 'agent-4'`
    );
    assert.deepEqual(profile, { display_name: 'Laura', is_enabled: false });
    const presence = await run(`SELECT 1 FROM public.staff_presence WHERE staff_id = 'agent-4'`);
    assert.equal(presence.length, 1);
  });
});

test('sales material links must be web addresses', async () => {
  await refuses(
    ADMIN,
    `SELECT public.admin_save_material(NULL, 'X', '', 'video', 'javascript:alert(1)', false)`,
    /https:\/\//
  );
  await refuses(
    ADMIN,
    `SELECT public.admin_save_material(NULL, 'X', '', 'video', '', true)`,
    /necesita un enlace/
  );
  await as(ADMIN, async (run) => {
    const [{ id: materialId }] = await run(
      `SELECT public.admin_save_material(NULL, 'Video', 'Demo', 'video', 'https://plw.test/v', true) AS id`
    );
    await run(
      `SELECT public.admin_save_material($1, 'Video 2', '', 'video', 'https://plw.test/v2', true)`,
      [materialId]
    );
    const [saved] = await run('SELECT title, approval FROM public.sales_materials WHERE id = $1', [
      materialId,
    ]);
    assert.deepEqual(saved, { title: 'Video 2', approval: 'approved' });
    await run('SELECT public.admin_delete_material($1)', [materialId]);
    assert.equal(
      (await run('SELECT 1 FROM public.sales_materials WHERE id = $1', [materialId])).length,
      0
    );
  });
});

test('starting or stopping an Anna dialer records who did it', async () => {
  const audit = (run) =>
    run(
      `SELECT actor_id, action, target_id FROM public.admin_audit_events
       WHERE action LIKE 'dental_dialer.%' ORDER BY id`
    );
  // The table is written by server functions; here the update runs as the database owner with
  // the administrator's session claims, as control_dental_dialer does.
  await db.transaction(async (tx) => {
    await tx.query(`INSERT INTO public.dental_agent_dialers (staff_id) VALUES ('agent-2')`);
    await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: ADMIN.userId, session_id: ADMIN.sessionId }),
    ]);
    await tx.query(`UPDATE public.dental_agent_dialers SET state = 'running'`);
    await tx.query(`UPDATE public.dental_agent_dialers SET state = 'running'`); // no change
    await tx.query(`SELECT set_config('request.jwt.claims', '{}', true)`);
    await tx.query(`UPDATE public.dental_agent_dialers SET state = 'paused'`);
    const rows = (await tx.query(
      `SELECT actor_id, action, target_id FROM public.admin_audit_events
       WHERE action LIKE 'dental_dialer.%' ORDER BY id`
    )).rows;
    assert.deepEqual(rows, [
      { actor_id: 'admin-1', action: 'dental_dialer.running', target_id: 'agent-2' },
      { actor_id: null, action: 'dental_dialer.paused', target_id: 'agent-2' },
    ]);
    await tx.rollback();
  });
  assert.deepEqual(await as(ADMIN, audit), []);
});

test('replies are sent only once Google is connected and there is something to send', async () => {
  await as(AGENT_1, async (run) => {
    assert.deepEqual(await run('SELECT public.email_sending_ready() AS ready'), [{ ready: false }]);
  });
  await db.transaction(async (tx) => {
    const tick = async () => (await tx.query('SELECT public.gmail_outbox_tick() AS id')).rows[0].id;
    assert.equal(await tick(), null, 'Google not connected');
    await tx.query(
      `INSERT INTO public.google_workspace_connections (mailbox_address, status, refresh_token_ciphertext)
       VALUES ('plw@plw.test', 'connected', 'cifrado')`
    );
    assert.equal(await tick(), null, 'nothing queued yet');
    await tx.query(
      `INSERT INTO public.conversations (id, prospect_id, subject) VALUES ($1, $1, 'Hola')`,
      [CLIENT_OF_1]
    );
    await tx.query(
      `INSERT INTO public.messages (id, conversation_id, author, body) VALUES ($1, $1, 'customer', 'Hola')`,
      [CLIENT_OF_1]
    );
    await tx.query(
      `INSERT INTO public.gmail_outbox (id, request_id, conversation_id, message_id, staff_id,
         mailbox_address, customer_key, recipient, subject, body, draft_revision, rfc_message_id)
       VALUES ($1, $1, $1, $1, 'agent-1', 'plw@plw.test', 'cliente', 'c@plw.test', 'Hola', 'Hola', 1, '<a@plw.test>')`,
      [CLIENT_OF_1]
    );
    assert.equal(await tick(), 1);
    await tx.rollback();
  });
});
