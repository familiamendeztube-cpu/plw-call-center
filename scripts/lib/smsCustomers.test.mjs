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

let delivery = 0;
const received = (q, from, body = 'Hola', stop = false) =>
  q('SELECT public.record_sms_received($1, $2, $3, $4) AS id', [from, body, `tx-${++delivery}`, stop]).then(
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

// A refused call rolls back to the savepoint, so the test sees the real error and can go on.
async function asBrowser(q, claims, sql, params) {
  await q('SAVEPOINT browser');
  await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await q('SET LOCAL ROLE authenticated');
  try {
    const rows = await q(sql, params);
    await q('RESET ROLE');
    await q('RELEASE SAVEPOINT browser');
    return rows;
  } catch (error) {
    await q('ROLLBACK TO SAVEPOINT browser');
    throw error;
  }
}

const reply = (q, claims, prospectId, key, body = 'Con gusto le ayudo') =>
  asBrowser(q, claims, 'SELECT public.register_sms_reply($1, $2, $3) AS r', [prospectId, body, key]).then(
    (rows) => rows[0].r
  );

before(async () => {
  db = await createTestDatabase();
});

after(async () => {
  await db?.close();
});

test('a new number becomes an SMS customer, assigned by round-robin and unread', async () => {
  await inTransaction(async (q) => {
    await signIn(q, 'agent-1');
    const id = await received(q, '+13055550101');
    const [customer] = await q(
      `SELECT p.source, p.business_name, p.phone, p.owner_id, c.unread
       FROM public.prospects p JOIN public.conversations c ON c.prospect_id = p.id WHERE p.id = $1`,
      [id]
    );
    assert.deepEqual(customer, {
      source: 'sms',
      business_name: '(305) 555-0101',
      phone: '+13055550101',
      owner_id: 'agent-1',
      unread: true,
    });
  });
});

test('a repeated delivery is stored once, and every text stays with its customer', async () => {
  await inTransaction(async (q) => {
    await signIn(q, 'agent-1');
    const first = await q("SELECT public.record_sms_received('+13055550102', 'Hola', 'tx-same', false) AS id");
    const again = await q("SELECT public.record_sms_received('+13055550102', 'Hola', 'tx-same', false) AS id");
    assert.equal(again[0].id, first[0].id);
    assert.equal(await received(q, '+13055550102', '¿Cuánto cuesta?'), first[0].id);
    const [{ texts, customers }] = await q(
      `SELECT (SELECT count(*)::int FROM public.sms_messages) AS texts,
              (SELECT count(*)::int FROM public.prospects WHERE source = 'sms') AS customers`
    );
    assert.deepEqual({ texts, customers }, { texts: 2, customers: 1 });
  });
});

test('a number PLW already knows joins that customer, in any format', async () => {
  await inTransaction(async (q) => {
    const [known] = await q(
      `INSERT INTO public.prospects (business_name, contact_name, phone, owner_id, source)
       VALUES ('Plomería Ruiz', 'Juan Ruiz', '(305) 555-0103', 'agent-2', 'ai_call') RETURNING id`
    );
    await q(`INSERT INTO public.conversations (prospect_id, subject) VALUES ($1, 'Plomería Ruiz')`, [known.id]);
    assert.equal(await received(q, '+13055550103'), known.id);
    const [{ count }] = await q('SELECT count(*)::int AS count FROM public.prospects');
    assert.equal(count, 1);
  });
});

test('an agent replies only after the customer texted first, and never after STOP', async () => {
  await inTransaction(async (q) => {
    const claims = await signIn(q, 'agent-1');
    const [quiet] = await q(
      `INSERT INTO public.prospects (business_name, contact_name, phone, owner_id, source)
       VALUES ('Taller Mora', 'Luis', '+13055550104', 'agent-1', 'ai_call') RETURNING id`
    );
    await assert.rejects(reply(q, claims, quiet.id, 'k-0'), /todavía no le ha escrito por SMS/);

    const id = await received(q, '+13055550104');
    assert.equal(id, quiet.id);
    const sent = await reply(q, claims, id, 'k-1');
    assert.deepEqual({ ...sent, id: undefined }, { id: undefined, status: 'queued', to: '+13055550104', reused: false });
    assert.equal((await reply(q, claims, id, 'k-1')).id, sent.id, 'the same key never sends twice');
    const [row] = await q('SELECT direction, staff_id, body FROM public.sms_messages WHERE id = $1', [sent.id]);
    assert.deepEqual(row, { direction: 'out', staff_id: 'agent-1', body: 'Con gusto le ayudo' });

    await received(q, '+13055550104', 'STOP', true);
    await assert.rejects(reply(q, claims, id, 'k-2'), /STOP/);
    await received(q, '+13055550104', 'Hola otra vez');
    assert.equal((await reply(q, claims, id, 'k-3')).status, 'queued', 'writing again reopens the number');
  });
});

test("an agent sees and answers only their own customers' texts", async () => {
  await inTransaction(async (q) => {
    await signIn(q, 'agent-1');
    const theirs = await received(q, '+13055550105');
    const claims = await signIn(q, 'agent-2');
    await q("UPDATE public.prospects SET owner_id = 'agent-1' WHERE id = $1", [theirs]);
    const visible = await asBrowser(q, claims, 'SELECT id FROM public.sms_messages', []);
    assert.equal(visible.length, 0);
    await assert.rejects(reply(q, claims, theirs, 'k-x'), /Cliente no disponible/);
    await assert.rejects(
      asBrowser(q, claims, "INSERT INTO public.sms_messages (prospect_id, direction, phone_e164, body, status) VALUES ($1, 'out', '+13055550105', 'x', 'queued')", [theirs]),
      /permission denied/
    );
  });
});

test('opening the texts clears the unread mark', async () => {
  await inTransaction(async (q) => {
    const claims = await signIn(q, 'agent-1');
    const id = await received(q, '+13055550106');
    await asBrowser(q, claims, 'SELECT public.mark_sms_read($1)', [id]);
    const [{ unread }] = await q('SELECT unread FROM public.conversations WHERE prospect_id = $1', [id]);
    assert.equal(unread, false);
  });
});

test('the admin sample-link text follows the same rule: only to a number that texted first', async () => {
  await inTransaction(async (q) => {
    const open = (phone) => q('SELECT public.sms_number_open($1) AS open', [phone]).then((rows) => rows[0].open);
    assert.equal(await open('+13055550107'), false);
    await signIn(q, 'agent-1');
    await received(q, '+13055550107');
    assert.equal(await open('+13055550107'), true);
    await received(q, '+13055550107', 'Baja', true);
    assert.equal(await open('+13055550107'), false);
    const source = await q(
      "SELECT pg_get_functiondef('public.us_sms_send(uuid, text, text, text, text, text, uuid)'::regprocedure) AS def"
    );
    assert.match(source[0].def, /sms_number_open\(v_to\)/);
  });
});
