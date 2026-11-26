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

const FOOTER = '\n\nProfessional Latino Workers. Responda STOP para no recibir más mensajes.';
const agreeOnCall = (q, claims, prospectId) =>
  asBrowser(q, claims, 'SELECT public.record_sms_consent($1) AS phone', [prospectId]).then((rows) => rows[0].phone);

test('an agent texts a customer once they agreed on a call, and never after STOP', async () => {
  await inTransaction(async (q) => {
    const claims = await signIn(q, 'agent-1');
    const [customer] = await q(
      `INSERT INTO public.prospects (business_name, contact_name, phone, owner_id, source)
       VALUES ('Taller Mora', 'Luis', '(305) 555-0104', 'agent-1', 'ai_call') RETURNING id`
    );
    await assert.rejects(reply(q, claims, customer.id, 'k-0'), /todavía no aceptó recibir SMS/);

    assert.equal(await agreeOnCall(q, claims, customer.id), '+13055550104');
    const [consent] = await q('SELECT staff_id FROM public.sms_consents WHERE prospect_id = $1', [customer.id]);
    assert.equal(consent.staff_id, 'agent-1', 'who marked it is kept');
    const first = await reply(q, claims, customer.id, 'k-1');
    assert.deepEqual(
      { status: first.status, to: first.to, body: first.body, reused: first.reused },
      { status: 'queued', to: '+13055550104', body: 'Con gusto le ayudo' + FOOTER, reused: false },
      'the first text says who writes and how to stop'
    );
    assert.equal((await reply(q, claims, customer.id, 'k-1')).id, first.id, 'the same key never sends twice');
    assert.equal((await reply(q, claims, customer.id, 'k-2', 'Le mando el enlace')).body, 'Le mando el enlace');

    await received(q, '+13055550104', 'STOP', true);
    await assert.rejects(reply(q, claims, customer.id, 'k-3'), /STOP/);
    await agreeOnCall(q, claims, customer.id);
    await assert.rejects(reply(q, claims, customer.id, 'k-4'), /STOP/, 'after STOP only the customer reopens it');
    await received(q, '+13055550104', 'Hola otra vez');
    assert.equal((await reply(q, claims, customer.id, 'k-5')).status, 'queued', 'writing again reopens the number');
  });
});

test('a customer who texts PLW can be answered, and consent needs a US number', async () => {
  await inTransaction(async (q) => {
    const claims = await signIn(q, 'agent-1');
    const id = await received(q, '+13055550108');
    const answer = await reply(q, claims, id, 'k-1');
    assert.equal(answer.to, '+13055550108');
    const [local] = await q(
      `INSERT INTO public.prospects (business_name, contact_name, phone, owner_id, source)
       VALUES ('Soda Tica', 'Ana', '8888-1111', 'agent-1', 'manual') RETURNING id`
    );
    await assert.rejects(agreeOnCall(q, claims, local.id), /no tiene un número de EE. UU./);
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
    await assert.rejects(agreeOnCall(q, claims, theirs), /Cliente no disponible/);
    assert.equal((await asBrowser(q, claims, 'SELECT id FROM public.sms_consents', [])).length, 0);
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

test('the admin sample link goes to a lead who agreed on the call or texted, never after STOP', async () => {
  await inTransaction(async (q) => {
    const open = (phone, agreed = false) =>
      q('SELECT public.sms_number_open($1, $2) AS open', [phone, agreed]).then((rows) => rows[0].open);
    assert.equal(await open('+13055550107'), false);
    assert.equal(await open('+13055550107', true), true, "the lead's call consent");
    await signIn(q, 'agent-1');
    await received(q, '+13055550107');
    assert.equal(await open('+13055550107'), true);
    await received(q, '+13055550107', 'Baja', true);
    assert.equal(await open('+13055550107', true), false);
    const source = await q(
      "SELECT pg_get_functiondef('public.us_sms_send(uuid, text, text, text, text, text, uuid)'::regprocedure) AS def"
    );
    assert.ok(source[0].def.includes("sms_number_open(v_to, v_lead.sms_consent AND v_lead.sms_mobile <> '')"));
  });
});
