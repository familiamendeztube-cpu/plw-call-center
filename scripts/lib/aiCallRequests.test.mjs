import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './testDatabase.mjs';

let db;

const call = (overrides = {}) => ({
  conversation_id: 'conv_test_1',
  caller_phone: '+50688887777',
  callback_phone: null,
  customer_name: 'Ana Mora',
  business_name: null,
  reason: 'Quiere información de planes',
  preferred_contact: 'whatsapp',
  preferred_time: 'mañana en la tarde',
  consent: true,
  summary: 'La clienta pidió que la contacten.',
  call_started_at: '2026-11-03T20:00:00Z',
  call_duration_seconds: 95,
  ...overrides,
});

// Each test runs in a transaction that is rolled back.
async function inTransaction(work) {
  await db.transaction(async (tx) => {
    const q = async (sql, params = []) => (await tx.query(sql, params)).rows;
    await work(q);
    await tx.rollback();
  });
}

const record = (q, payload, route = true) =>
  q('SELECT public.record_ai_call($1::jsonb, $2) AS id', [JSON.stringify(payload), route]).then(
    (rows) => rows[0].id
  );

async function makeAvailable(q, staffId, availability = 'active') {
  const [user] = await q('INSERT INTO auth.users (id) VALUES (gen_random_uuid()) RETURNING id');
  await q(`UPDATE public.staff_profiles SET is_enabled = true, auth_user_id = $1 WHERE id = $2`, [
    user.id,
    staffId,
  ]);
  await q(
    `INSERT INTO public.staff_presence (staff_id, availability, last_heartbeat_at)
     VALUES ($1, $2, now())
     ON CONFLICT (staff_id) DO UPDATE SET availability = $2, last_heartbeat_at = now()`,
    [staffId, availability]
  );
}

before(async () => {
  db = await createTestDatabase();
});

after(async () => {
  await db?.close();
});

test('a routed call becomes a customer and goes to the available agent', async () => {
  await inTransaction(async (q) => {
    await makeAvailable(q, 'agent-1');
    const id = await record(q, call());
    const [row] = await q(
      `SELECT r.status, r.business_name, p.source, p.business_name AS label, p.owner_id, p.phone
       FROM public.ai_call_requests r JOIN public.prospects p ON p.id = r.prospect_id WHERE r.id = $1`,
      [id]
    );
    assert.deepEqual(row, {
      status: 'pending',
      business_name: null,
      source: 'ai_call',
      label: 'Ana Mora',
      owner_id: 'agent-1',
      phone: '+50688887777',
    });
  });
});

test('a paused agent receives nothing and the call waits in the queue', async () => {
  await inTransaction(async (q) => {
    await makeAvailable(q, 'agent-1', 'paused');
    const id = await record(q, call());
    const [row] = await q(
      `SELECT p.owner_id, q.status FROM public.ai_call_requests r
       JOIN public.prospects p ON p.id = r.prospect_id
       JOIN public.assignment_queue q ON q.prospect_id = p.id WHERE r.id = $1`,
      [id]
    );
    assert.deepEqual(row, { owner_id: null, status: 'waiting' });
  });
});

test('a repeated delivery returns the first request and creates nothing new', async () => {
  await inTransaction(async (q) => {
    const first = await record(q, call());
    const second = await record(q, call({ customer_name: 'Otro nombre' }));
    assert.equal(second, first);
    const [counts] = await q(`SELECT
      (SELECT count(*) FROM public.ai_call_requests)::int AS requests,
      (SELECT count(*) FROM public.prospects)::int AS prospects`);
    assert.deepEqual(counts, { requests: 1, prospects: 1 });
  });
});

test('a returning caller is attached to their customer and current agent', async () => {
  await inTransaction(async (q) => {
    const [existing] = await q(
      `INSERT INTO public.prospects (business_name, phone, owner_id)
       VALUES ('Panadería Sol', '8888-7777', 'agent-2') RETURNING id`
    );
    const id = await record(q, call());
    const [row] = await q(`SELECT prospect_id FROM public.ai_call_requests WHERE id = $1`, [id]);
    assert.equal(row.prospect_id, existing.id);
    const [{ count }] = await q(`SELECT count(*)::int AS count FROM public.prospects`);
    assert.equal(count, 1);
  });
});

test('a call not sent to an agent is kept without creating a customer', async () => {
  await inTransaction(async (q) => {
    const id = await record(q, call({ caller_phone: null, consent: false }), false);
    const [row] = await q(`SELECT prospect_id, status FROM public.ai_call_requests WHERE id = $1`, [
      id,
    ]);
    assert.deepEqual(row, { prospect_id: null, status: 'canceled' });
    const [{ count }] = await q(`SELECT count(*)::int AS count FROM public.prospects`);
    assert.equal(count, 0);
  });
});

test('consent false is stored as false, not as empty', async () => {
  await inTransaction(async (q) => {
    const id = await record(q, call({ consent: false }));
    const [row] = await q(`SELECT consent FROM public.ai_call_requests WHERE id = $1`, [id]);
    assert.equal(row.consent, false);
  });
});

test('details the caller did not give stay empty', async () => {
  await inTransaction(async (q) => {
    const id = await record(q, {
      conversation_id: 'conv_empty',
      caller_phone: null,
      call_started_at: '2026-11-03T20:00:00Z',
    });
    const [row] = await q(
      `SELECT r.customer_name, r.reason, r.preferred_contact, r.consent, r.summary, p.business_name AS label
       FROM public.ai_call_requests r JOIN public.prospects p ON p.id = r.prospect_id WHERE r.id = $1`,
      [id]
    );
    assert.deepEqual(row, {
      customer_name: null,
      reason: null,
      preferred_contact: null,
      consent: null,
      summary: null,
      label: 'Llamada IA',
    });
  });
});
