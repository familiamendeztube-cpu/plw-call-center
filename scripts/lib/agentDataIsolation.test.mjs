import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './testDatabase.mjs';

const id = (number) => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;

const AGENT_1 = { staffId: 'agent-1', userId: id(101), sessionId: id(201) };
const AGENT_2 = { staffId: 'agent-2', userId: id(102), sessionId: id(202) };
const AGENT_WITHOUT_CLIENTS = { staffId: 'agent-3', userId: id(103), sessionId: id(203) };
const ADMIN = { staffId: 'admin-1', userId: id(109), sessionId: id(209) };
const ANONYMOUS = null;

const CLIENT_OF_1 = id(1);
const CLIENT_OF_2 = id(2);
const UNASSIGNED = id(3);

const OWNED_TABLES = [
  'ai_call_requests',
  'prospects',
  'conversations',
  'messages',
  'private_notes',
  'followups',
  'activity_events',
  'whatsapp_chats',
];
const PERSONAL_TABLES = [
  ['drafts', 'conversation_id'],
  ['notifications', 'id'],
  ['gmail_outbox', 'id'],
];
const ADMIN_ONLY_TABLES = [
  'assignment_queue',
  'assignment_history',
  'admin_audit_events',
  'ai_webhook_failures',
];
const OUTBOUND_ADMIN_TABLES = [
  'ai_outbound_campaigns',
  'ai_outbound_leads',
  'ai_outbound_campaign_agents',
  'ai_outbound_do_not_call',
  'ai_outbound_settings',
  'ai_outbound_test_calls',
];
const OUTBOUND_INTAKE_TABLES = OUTBOUND_ADMIN_TABLES.filter(
  (table) => !['ai_outbound_settings', 'ai_outbound_test_calls'].includes(table)
);
const SHARED_TABLES = ['sales_materials', 'settings'];

// Any new entry here is a new way for a browser to reach data, so it needs its own
// isolation test before it joins these lists.
const BROWSER_READABLE_TABLES = [
  'asterisk_calls',
  'dental_campaigns',
  'dental_leads',
  'dental_agent_dialers',
  'dental_dialer_runtime',
  'dental_calls',
  ...OWNED_TABLES,
  ...PERSONAL_TABLES.map(([table]) => table),
  ...ADMIN_ONLY_TABLES,
  ...OUTBOUND_ADMIN_TABLES,
  ...SHARED_TABLES,
  'staff_presence',
  'staff_profiles',
].sort();

const BROWSER_CALLABLE_FUNCTIONS = [
  'add_private_note',
  'admin_create_device_enrollment',
  'admin_gmail_sync_status',
  'admin_list_agents',
  'admin_list_devices',
  'admin_revoke_device',
  'admin_set_gmail_sync',
  'admin_set_setting',
  'admin_update_staff',
  'assign_dental_leads',
  'can_access_conversation',
  'can_access_prospect',
  'confirm_dental_transfer',
  'control_dental_dialer',
  'control_dental_dialer_if_active',
  'create_inquiry',
  'current_staff_id',
  'get_reply_target',
  'is_admin',
  'list_overdue_conversations',
  'mark_conversation_read',
  'mark_notifications_read',
  'mark_whatsapp_read',
  'public_agent_directory',
  'reassign_prospect',
  'record_heartbeat',
  'request_reply_send',
  'save_draft',
  'schedule_followup',
  'set_ai_call_status',
  'set_availability',
  'set_followup_completed',
  'set_next_action',
  'set_payment_status',
  'set_prospect_stage',
  'setting_int',
  'update_dental_lead',
];

const OWNER_ACTIONS = [
  ['change the stage', `SELECT public.set_prospect_stage($1, 'contacted')`],
  ['change the next action', `SELECT public.set_next_action($1, 'Llamar', NULL)`],
  ['add a private note', `SELECT public.add_private_note($1, 'Nota')`],
  ['schedule a follow-up', `SELECT public.schedule_followup($1, 'callback', 'Llamar', now())`],
  ['complete a follow-up', 'SELECT public.set_followup_completed($1, true)'],
  ['mark the conversation read', 'SELECT public.mark_conversation_read($1)'],
  ['save a reply draft', `SELECT public.save_draft($1, 'Borrador', 1)`],
  ['change an AI call status', `SELECT public.set_ai_call_status($1, 'completed')`],
  ['mark the WhatsApp chat read', 'SELECT public.mark_whatsapp_read($1)'],
];

const ASSIGNED_AGENT_ONLY_ACTIONS = [
  ['look up the reply address', 'SELECT public.get_reply_target($1)'],
  ['send a reply', 'SELECT public.request_reply_send($1, gen_random_uuid())'],
];

const ADMIN_ACTIONS = [
  ['record a payment', `SELECT public.set_payment_status('${CLIENT_OF_2}', 'paid')`],
  ['reassign a client', `SELECT public.reassign_prospect('${CLIENT_OF_2}', 'agent-1', 'Quiero')`],
  [
    'create an inquiry',
    `SELECT public.create_inquiry('Negocio', '', '', '', '', '', 'manual', '', false, 'clave')`,
  ],
  ['edit an agent', `SELECT public.admin_update_staff('agent-2', 'Nombre', false, 1)`],
  ['change a setting', `SELECT public.admin_set_setting('overdue_minutes', 5)`],
  ['register a computer', `SELECT public.admin_create_device_enrollment('Equipo')`],
  ['revoke a computer', `SELECT public.admin_revoke_device('${id(99)}')`],
  ['read the Gmail status', 'SELECT public.admin_gmail_sync_status()'],
  ['change the Gmail sync', 'SELECT public.admin_set_gmail_sync(true, now())'],
];

let db;

async function seedClient(clientId, ownerId) {
  await db.query(`INSERT INTO public.prospects (id, business_name, owner_id) VALUES ($1, $2, $3)`, [
    clientId,
    `Cliente ${clientId}`,
    ownerId,
  ]);
  await db.query(
    `INSERT INTO public.conversations (id, prospect_id, subject) VALUES ($1, $1, 'Hola')`,
    [clientId]
  );
  await db.query(
    `INSERT INTO public.messages (id, conversation_id, author, body) VALUES ($1, $1, 'customer', 'Hola')`,
    [clientId]
  );
  await db.query(
    `INSERT INTO public.ai_call_requests (id, conversation_id, prospect_id, call_started_at)
     VALUES ($1, $2, $1, now())`,
    [clientId, `conv_${clientId.slice(-4)}`]
  );
  await db.query(
    `INSERT INTO public.whatsapp_chats (chatwoot_conversation_id, prospect_id) VALUES ($1, $2)`,
    [Number(clientId.slice(-4)), clientId]
  );
  if (!ownerId) return;

  await db.query(
    `INSERT INTO public.private_notes (id, prospect_id, author_id, body) VALUES ($1, $1, $2, 'Nota')`,
    [clientId, ownerId]
  );
  await db.query(
    `INSERT INTO public.followups (id, prospect_id, agent_id, kind, title, due_at)
     VALUES ($1, $1, $2, 'callback', 'Llamar', now())`,
    [clientId, ownerId]
  );
  await db.query(
    `INSERT INTO public.activity_events (id, agent_id, prospect_id, kind, summary)
     VALUES ($1, $2, $1, 'note', 'Nota agregada')`,
    [clientId, ownerId]
  );
  await db.query(
    `INSERT INTO public.notifications (id, staff_id, prospect_id, kind, body)
     VALUES ($1, $2, $1, 'assignment', 'Cliente nuevo')`,
    [clientId, ownerId]
  );
  await db.query(
    `INSERT INTO public.drafts (conversation_id, staff_id, body) VALUES ($1, $2, 'Borrador')`,
    [clientId, ownerId]
  );
  await db.query(
    `INSERT INTO public.gmail_outbox (id, request_id, conversation_id, message_id, staff_id,
       mailbox_address, customer_key, recipient, subject, body, draft_revision, rfc_message_id)
     VALUES ($1, $1, $1, $1, $2, 'ventas@plw.test', 'cliente', 'cliente@plw.test', 'Hola', 'Hola', 1, $3)`,
    [clientId, ownerId, `<${clientId}@plw.test>`]
  );
}

async function seed() {
  for (const { staffId, userId, sessionId } of [AGENT_1, AGENT_2, AGENT_WITHOUT_CLIENTS, ADMIN]) {
    await db.query('INSERT INTO auth.users (id) VALUES ($1)', [userId]);
    await db.query('INSERT INTO auth.sessions (id, user_id) VALUES ($1, $2)', [sessionId, userId]);
    await db.query(
      'UPDATE public.staff_profiles SET auth_user_id = $1, is_enabled = true WHERE id = $2',
      [userId, staffId]
    );
  }
  await seedClient(CLIENT_OF_1, 'agent-1');
  await seedClient(CLIENT_OF_2, 'agent-2');
  await seedClient(UNASSIGNED, null);

  await db.query(`INSERT INTO public.assignment_queue (prospect_id) VALUES ($1)`, [UNASSIGNED]);
  await db.query(
    `INSERT INTO public.assignment_history (prospect_id, to_owner_id, mechanism)
     VALUES ($1, 'agent-1', 'manual')`,
    [CLIENT_OF_1]
  );
  await db.query(`INSERT INTO public.admin_audit_events (action) VALUES ('prueba')`);
  await db.query(`INSERT INTO public.ai_webhook_failures (reason) VALUES ('prueba')`);
  // Phone server records: one per agent, plus an unanswered queue call that belongs to nobody.
  for (const [uniqueId, staffId] of [['call-1', 'agent-1'], ['call-2', 'agent-2'], ['call-queue', null]]) {
    await db.query(
      `INSERT INTO public.asterisk_calls (unique_id, linked_id, staff_id, direction, number,
         disposition, talk_seconds, started_at, ended_at)
       VALUES ($1, $1, $2, 'inbound', '22223333', 'ANSWERED', 5, now(), now())`,
      [uniqueId, staffId]
    );
  }
}

async function become(tx, person) {
  await tx.exec('RESET ROLE');
  const claims = person ? { sub: person.userId, session_id: person.sessionId } : {};
  await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await tx.exec(`SET LOCAL ROLE ${person ? 'authenticated' : 'anon'}`);
}

// Nothing a test does survives it, so the tests can't affect each other.
async function rollingBack(work) {
  let result;
  await db.transaction(async (tx) => {
    result = await work(async (person, sql, params = []) => {
      await become(tx, person);
      return (await tx.query(sql, params)).rows;
    });
    await tx.rollback();
  });
  return result;
}

const runAs = (person, sql, params) => rollingBack((run) => run(person, sql, params));

async function visibleIds(person, table, column = 'id') {
  const rows = await runAs(person, `SELECT ${column} AS id FROM public.${table} ORDER BY 1`);
  return rows.map((row) => row.id);
}

async function allIds(table, column = 'id') {
  const { rows } = await db.query(`SELECT ${column} AS id FROM public.${table} ORDER BY 1`);
  return rows.map((row) => row.id);
}

before(async () => {
  db = await createTestDatabase();
  await seed();
});

after(async () => {
  await db?.close();
});

for (const table of OWNED_TABLES) {
  test(`${table}: each agent sees only their own and the administrator sees all`, async () => {
    const column = table === 'whatsapp_chats' ? 'prospect_id' : 'id';
    assert.deepEqual(await visibleIds(AGENT_1, table, column), [CLIENT_OF_1]);
    assert.deepEqual(await visibleIds(AGENT_2, table, column), [CLIENT_OF_2]);
    assert.deepEqual(await visibleIds(AGENT_WITHOUT_CLIENTS, table, column), []);
    assert.deepEqual(await visibleIds(ADMIN, table, column), await allIds(table, column));
  });
}

for (const [table, column] of PERSONAL_TABLES) {
  test(`${table}: stay private to the agent, even from the administrator`, async () => {
    assert.deepEqual(await visibleIds(AGENT_1, table, column), [CLIENT_OF_1]);
    assert.deepEqual(await visibleIds(AGENT_2, table, column), [CLIENT_OF_2]);
    assert.deepEqual(await visibleIds(AGENT_WITHOUT_CLIENTS, table, column), []);
    assert.deepEqual(await visibleIds(ADMIN, table, column), []);
  });
}

for (const table of ['staff_profiles', 'staff_presence']) {
  test(`${table}: an agent sees only their own row`, async () => {
    const column = table === 'staff_profiles' ? 'id' : 'staff_id';
    assert.deepEqual(await visibleIds(AGENT_1, table, column), ['agent-1']);
    assert.deepEqual(await visibleIds(AGENT_2, table, column), ['agent-2']);
    assert.equal((await visibleIds(ADMIN, table, column)).length, 4);
  });
}

test('a dental dialer starts only while its agent is Activo with the app open; pausing always works', async () => {
  const attempt = async (person, action, availability) => {
    let outcome;
    await db.transaction(async (tx) => {
      try {
        if (availability)
          await tx.query(
            `INSERT INTO public.staff_presence (staff_id, availability, last_heartbeat_at)
             VALUES ('agent-2', $1, now())
             ON CONFLICT (staff_id) DO UPDATE SET availability = $1, last_heartbeat_at = now()`,
            [availability]
          );
        await become(tx, person);
        await tx.query(`SELECT public.control_dental_dialer_if_active('agent-2', $1)`, [action]);
        outcome = 'ok';
      } catch (error) {
        outcome = error.message;
      }
      await tx.rollback();
    });
    return outcome;
  };
  const needsActive = /estar en Activo/;
  assert.match(await attempt(ADMIN, 'activate', 'paused'), needsActive);
  assert.match(await attempt(ADMIN, 'resume', 'paused'), needsActive);
  // Activo passes this check; whatever control_dental_dialer says next is its own rule.
  assert.doesNotMatch(await attempt(ADMIN, 'activate', 'active'), needsActive);
  assert.doesNotMatch(await attempt(ADMIN, 'pause', 'paused'), needsActive);
  assert.match(await attempt(AGENT_2, 'activate', 'active'), /Solo administración/);
});

test('asterisk_calls: an agent sees only their own calls and the administrator sees all', async () => {
  const ids = (person) => visibleIds(person, 'asterisk_calls', 'unique_id');
  assert.deepEqual(await ids(AGENT_1), ['call-1']);
  assert.deepEqual(await ids(AGENT_2), ['call-2']);
  assert.deepEqual(await ids(AGENT_WITHOUT_CLIENTS), []);
  assert.deepEqual(await ids(ADMIN), ['call-1', 'call-2', 'call-queue']);
});

for (const table of ADMIN_ONLY_TABLES) {
  test(`${table}: only the administrator can read it`, async () => {
    assert.deepEqual(await visibleIds(AGENT_1, table), []);
    assert.equal((await visibleIds(ADMIN, table)).length, 1);
  });
}

for (const table of SHARED_TABLES) {
  test(`${table}: is the same for every agent`, async () => {
    const column = table === 'settings' ? 'key' : 'id';
    const shared = await visibleIds(AGENT_1, table, column);
    assert.ok(shared.length > 0);
    assert.deepEqual(await visibleIds(AGENT_2, table, column), shared);
  });
}

test('the overdue list only names the agent asking', async () => {
  await db.transaction(async (tx) => {
    await tx.exec(`UPDATE public.conversations SET last_message_at = now() - interval '1 day'`);
    await become(tx, AGENT_1);
    const { rows } = await tx.query('SELECT owner_id FROM public.list_overdue_conversations()');
    assert.deepEqual(rows, [{ owner_id: 'agent-1' }]);
    await tx.rollback();
  });
});

for (const [name, sql] of OWNER_ACTIONS) {
  test(`only the owner can ${name}`, async () => {
    await assert.rejects(
      runAs(AGENT_1, sql, [CLIENT_OF_2]),
      /No autorizado|Solo el agente|no disponible/
    );
    await assert.doesNotReject(runAs(AGENT_2, sql, [CLIENT_OF_2]));
  });
}

for (const [name, sql] of ASSIGNED_AGENT_ONLY_ACTIONS) {
  test(`an agent cannot ${name} for another agent's client`, async () => {
    await assert.rejects(runAs(AGENT_1, sql, [CLIENT_OF_2]), /Solo el agente asignado/);
    await assert.rejects(runAs(ADMIN, sql, [CLIENT_OF_2]), /Solo el agente asignado/);
  });
}

for (const [name, sql] of ADMIN_ACTIONS) {
  test(`an agent cannot ${name}`, async () => {
    await assert.rejects(runAs(AGENT_1, sql), /No autorizado/);
  });
}

test('the administrator can do what agents are refused', async () => {
  await assert.doesNotReject(runAs(ADMIN, ADMIN_ACTIONS[0][1]));
});

test('agent lists meant for the administrator come back empty', async () => {
  assert.deepEqual(await runAs(AGENT_1, 'SELECT * FROM public.admin_list_agents()'), []);
  assert.deepEqual(await runAs(AGENT_1, 'SELECT * FROM public.admin_list_devices()'), []);
  assert.equal((await runAs(ADMIN, 'SELECT * FROM public.admin_list_agents()')).length, 3);
});

test('a reassigned client moves to the new agent and leaves the old one', async () => {
  await rollingBack(async (run) => {
    await run(ADMIN, `SELECT public.reassign_prospect($1, 'agent-2', 'Cambio de zona')`, [
      CLIENT_OF_1,
    ]);
    const seenBy = async (person) =>
      (await run(person, 'SELECT id FROM public.prospects ORDER BY 1')).map((row) => row.id);
    assert.deepEqual(await seenBy(AGENT_1), []);
    assert.deepEqual(await seenBy(AGENT_2), [CLIENT_OF_1, CLIENT_OF_2]);
  });
});

for (const [name, cutOff] of [
  ['a disabled agent', `UPDATE public.staff_profiles SET is_enabled = false WHERE id = 'agent-1'`],
  [
    'an agent whose sessions were revoked',
    `UPDATE public.staff_profiles SET sessions_revoked_at = now() + interval '1 hour' WHERE id = 'agent-1'`,
  ],
  [
    'an agent whose session expired',
    `UPDATE auth.sessions SET not_after = now() - interval '1 hour' WHERE user_id = '${AGENT_1.userId}'`,
  ],
]) {
  test(`${name} stops seeing their clients at once`, async () => {
    await db.transaction(async (tx) => {
      await tx.exec(cutOff);
      await become(tx, AGENT_1);
      assert.deepEqual((await tx.query('SELECT id FROM public.prospects')).rows, []);
      await tx.rollback();
    });
  });
}

test('a session of another agent does not count', async () => {
  const stolen = { ...AGENT_1, sessionId: AGENT_2.sessionId };
  assert.deepEqual(await visibleIds(stolen, 'prospects'), []);
});

test('someone not signed in can read no table', async () => {
  for (const table of BROWSER_READABLE_TABLES) {
    await assert.rejects(runAs(ANONYMOUS, `SELECT 1 FROM public.${table}`), /permission denied/);
  }
});

test('the login directory only says who the agents are', async () => {
  const rows = await runAs(ANONYMOUS, 'SELECT * FROM public.public_agent_directory()');
  assert.deepEqual(
    rows.map((row) => row.id),
    ['agent-1', 'agent-2', 'agent-3']
  );
  assert.deepEqual(Object.keys(rows[0]).sort(), ['display_name', 'id', 'is_enabled']);
});

test('no signed-in staff member can read PINs, phone passwords or Chatwoot tokens', async () => {
  for (const table of ['staff_credentials', 'agent_sip_accounts', 'chatwoot_agent_accounts']) {
    await assert.rejects(runAs(AGENT_1, `SELECT * FROM public.${table}`), /permission denied/);
    await assert.rejects(runAs(ADMIN, `SELECT * FROM public.${table}`), /permission denied/);
  }
});

test('browser writes are limited to the admin-only outbound intake tables', async () => {
  await assert.rejects(
    runAs(AGENT_1, `UPDATE public.prospects SET owner_id = 'agent-1' WHERE id = $1`, [CLIENT_OF_2]),
    /permission denied/
  );
  const { rows } = await db.query(`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND (has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE'))`);
  assert.deepEqual(rows.map((row) => row.relname).sort(), OUTBOUND_INTAKE_TABLES.sort());
});

test('every table has row level security', async () => {
  const { rows } = await db.query(`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`);
  assert.deepEqual(rows, []);
});

test('browsers can read only the reviewed tables', async () => {
  const { rows } = await db.query(`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm')
      AND has_table_privilege('authenticated', c.oid, 'SELECT') ORDER BY 1`);
  assert.deepEqual(
    rows.map((row) => row.relname),
    BROWSER_READABLE_TABLES
  );
});

test('browsers can call only the reviewed functions', async () => {
  const { rows } = await db.query(`
    SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anonymous
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE') ORDER BY 1`);
  assert.deepEqual(
    rows.map((row) => row.proname),
    BROWSER_CALLABLE_FUNCTIONS
  );
  assert.deepEqual(
    rows.filter((row) => row.anonymous).map((row) => row.proname),
    ['public_agent_directory']
  );
});
