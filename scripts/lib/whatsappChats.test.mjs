import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './testDatabase.mjs';

let db;

// Each test runs in a transaction that is rolled back.
async function inTransaction(work) {
  await db.transaction(async (tx) => {
    const q = async (sql, params = []) => (await tx.query(sql, params)).rows;
    await work(q);
    await tx.rollback();
  });
}

const record = (q, conversationId, phone, name) =>
  q('SELECT public.record_whatsapp_message($1, $2, $3) AS id', [conversationId, phone, name]).then(
    (rows) => rows[0].id
  );

/** Links the agent to a login with a live session; returns the claims a browser would carry. */
async function signIn(q, staffId) {
  const [user] = await q('INSERT INTO auth.users (id) VALUES (gen_random_uuid()) RETURNING id');
  const [session] = await q(
    'INSERT INTO auth.sessions (id, user_id) VALUES (gen_random_uuid(), $1) RETURNING id',
    [user.id]
  );
  await q('UPDATE public.staff_profiles SET is_enabled = true, auth_user_id = $1 WHERE id = $2', [
    user.id,
    staffId,
  ]);
  return { sub: user.id, session_id: session.id };
}

async function asBrowser(q, claims, sql, params) {
  await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await q('SET LOCAL ROLE authenticated');
  try {
    return await q(sql, params);
  } finally {
    await q('RESET ROLE');
  }
}

const unreadMarks = (q, prospectId) =>
  q(
    `SELECT w.unread AS chat, c.unread AS list
     FROM public.whatsapp_chats w JOIN public.conversations c ON c.prospect_id = w.prospect_id
     WHERE w.prospect_id = $1`,
    [prospectId]
  ).then((rows) => rows[0]);

before(async () => {
  db = await createTestDatabase();
});

after(async () => {
  await db?.close();
});

test('a new number becomes a WhatsApp customer, assigned by round-robin and unread', async () => {
  await inTransaction(async (q) => {
    await signIn(q, 'agent-1');
    const id = await record(q, 41, '+506 8888-1111', 'Ana Mora');
    const [customer] = await q(
      'SELECT source, business_name, contact_name, phone, owner_id FROM public.prospects WHERE id = $1',
      [id]
    );
    assert.deepEqual(customer, {
      source: 'whatsapp',
      business_name: 'Ana Mora',
      contact_name: 'Ana Mora',
      phone: '+506 8888-1111',
      owner_id: 'agent-1',
    });
    assert.deepEqual(await unreadMarks(q, id), { chat: true, list: true });
  });
});

test('every message of one chat stays with its customer and marks it unread again', async () => {
  await inTransaction(async (q) => {
    const claims = await signIn(q, 'agent-1');
    const id = await record(q, 42, '+50688882222', 'Ana');
    assert.equal(await record(q, 42, '+50688882222', 'Ana'), id);
    const [{ count }] = await q(`SELECT count(*)::int AS count FROM public.prospects WHERE source = 'whatsapp'`);
    assert.equal(count, 1);

    await asBrowser(q, claims, 'SELECT public.mark_whatsapp_read($1)', [id]);
    assert.deepEqual(await unreadMarks(q, id), { chat: false, list: false });
    await record(q, 42, '+50688882222', 'Ana');
    assert.deepEqual(await unreadMarks(q, id), { chat: true, list: true });
  });
});

test('a number PLW already knows joins that customer, whatever the WhatsApp name', async () => {
  await inTransaction(async (q) => {
    const [known] = await q(
      `INSERT INTO public.prospects (business_name, contact_name, phone, owner_id, source)
       VALUES ('Taller Mora', 'Luis Mora', '8888-3333', 'agent-2', 'ai_call') RETURNING id`
    );
    await q(`INSERT INTO public.conversations (prospect_id, subject) VALUES ($1, 'Taller Mora')`, [
      known.id,
    ]);
    assert.equal(await record(q, 43, '+506 8888 3333', 'Taller 🚗'), known.id);
    const [{ count }] = await q('SELECT count(*)::int AS count FROM public.prospects');
    assert.equal(count, 1);
    assert.deepEqual(await unreadMarks(q, known.id), { chat: true, list: true });
  });
});

async function customerWithPhone(q, contactName, phone, createdAt) {
  const [row] = await q(
    `INSERT INTO public.prospects (business_name, contact_name, phone, owner_id, created_at)
     VALUES ($1, $1, $2, 'agent-1', $3) RETURNING id`,
    [contactName, phone, createdAt]
  );
  await q(`INSERT INTO public.conversations (prospect_id, subject) VALUES ($1, $2)`, [row.id, contactName]);
  return row.id;
}

const chatRow = (q, conversationId) =>
  q(
    `SELECT w.prospect_id, w.ambiguous_match, p.contact_name
     FROM public.whatsapp_chats w JOIN public.prospects p ON p.id = w.prospect_id
     WHERE w.chatwoot_conversation_id = $1`,
    [conversationId]
  ).then((rows) => rows[0]);

test("a matched customer keeps their own name, not the WhatsApp nickname", async () => {
  await inTransaction(async (q) => {
    const luis = await customerWithPhone(q, 'Luis Mora', '8888-4444', '2026-11-01');
    await record(q, 44, '+50688884444', 'Taller 🚗');
    assert.deepEqual(await chatRow(q, 44), {
      prospect_id: luis,
      ambiguous_match: false,
      contact_name: 'Luis Mora',
    });
  });
});

test('several customers on one number: the WhatsApp name picks the one it fits', async () => {
  await inTransaction(async (q) => {
    const pedro = await customerWithPhone(q, 'Pedro Picapiedra', '88885555', '2026-11-01');
    await customerWithPhone(q, 'Juan López', '88885555', '2026-11-02');
    await record(q, 45, '+50688885555', 'Pedro');
    assert.deepEqual(await chatRow(q, 45), {
      prospect_id: pedro,
      ambiguous_match: false,
      contact_name: 'Pedro Picapiedra',
    });
  });
});

test('several customers and no name to tell them apart: the newest, flagged for the agent', async () => {
  await inTransaction(async (q) => {
    await customerWithPhone(q, 'Pedro Picapiedra', '88886666', '2026-11-01');
    const juan = await customerWithPhone(q, 'Juan López', '88886666', '2026-11-02');
    await record(q, 46, '+50688886666', 'Taller 🚗');
    assert.deepEqual(await chatRow(q, 46), {
      prospect_id: juan,
      ambiguous_match: true,
      contact_name: 'Juan López',
    });
    const [{ count }] = await q('SELECT count(*)::int AS count FROM public.prospects');
    assert.equal(count, 2);
  });
});

const startFor = (q, agent, phone, name) =>
  q('SELECT customer, conversation FROM public.start_whatsapp_customer($1, $2, $3)', [agent, phone, name]);

test('an agent who writes to a new number gets that customer, already contacted, and nothing unread', async () => {
  await inTransaction(async (q) => {
    await signIn(q, 'agent-1');
    const [{ customer, conversation }] = await startFor(q, 'agent-1', '+50688887777', 'Ana Mora');
    assert.equal(conversation, null);
    const [row] = await q(
      `SELECT p.source, p.business_name, p.contact_name, p.phone, p.owner_id, p.stage, c.status
       FROM public.prospects p JOIN public.conversations c ON c.prospect_id = p.id WHERE p.id = $1`,
      [customer]
    );
    assert.deepEqual(row, {
      source: 'whatsapp',
      business_name: 'Ana Mora',
      contact_name: 'Ana Mora',
      phone: '+50688887777',
      owner_id: 'agent-1',
      stage: 'contacted',
      status: 'waiting_customer',
    });
    const [history] = await q('SELECT to_owner_id, mechanism FROM public.assignment_history WHERE prospect_id = $1', [
      customer,
    ]);
    assert.deepEqual(history, { to_owner_id: 'agent-1', mechanism: 'manual' });

    await q('SELECT public.link_whatsapp_chat(50, $1)', [customer]);
    assert.deepEqual(await unreadMarks(q, customer), { chat: false, list: false });
    // Writing to the number again finds the same customer and its chat.
    assert.deepEqual(await startFor(q, 'agent-1', '8888-7777', ''), [{ customer, conversation: 50 }]);
    // When the customer answers, the reply lands in the same chat.
    assert.equal(await record(q, 50, '+50688887777', 'Anita'), customer);
  });
});

test("the agent's own customer keeps its name; another agent's customer is not theirs to write to", async () => {
  await inTransaction(async (q) => {
    await signIn(q, 'agent-1');
    await signIn(q, 'agent-2');
    const luis = await customerWithPhone(q, 'Luis Mora', '8888-8888', '2026-11-01');
    assert.deepEqual(await startFor(q, 'agent-1', '+50688888888', 'Otro nombre'), [
      { customer: luis, conversation: null },
    ]);
    const [{ contact_name }] = await q('SELECT contact_name FROM public.prospects WHERE id = $1', [luis]);
    assert.equal(contact_name, 'Luis Mora');

    assert.deepEqual(await startFor(q, 'agent-2', '+50688888888', 'Luis'), []);
    const [{ count }] = await q('SELECT count(*)::int AS count FROM public.prospects');
    assert.equal(count, 1);
  });
});
