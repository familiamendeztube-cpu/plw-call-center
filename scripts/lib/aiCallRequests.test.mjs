import { readFileSync } from 'node:fs';
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
      `SELECT r.status, r.business_name, p.source, p.business_name AS label, p.owner_id, p.phone,
              p.contact_name, p.service_interest
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
      contact_name: 'Ana Mora',
      service_interest: 'Quiere información de planes',
    });
  });
});

const ownerAndQueue = (q, id) =>
  q(
    `SELECT p.owner_id, q.status FROM public.ai_call_requests r
     JOIN public.prospects p ON p.id = r.prospect_id
     JOIN public.assignment_queue q ON q.prospect_id = p.id WHERE r.id = $1`,
    [id]
  ).then((rows) => rows[0]);

test('with nobody online and Activo, the call still goes to an enabled agent', async () => {
  await inTransaction(async (q) => {
    await makeAvailable(q, 'agent-1', 'paused');
    const id = await record(q, call());
    assert.deepEqual(await ownerAndQueue(q, id), { owner_id: 'agent-1', status: 'assigned' });
  });
});

test('calls take turns between agents whether they are Activo or not', async () => {
  await inTransaction(async (q) => {
    await makeAvailable(q, 'agent-1', 'paused');
    await makeAvailable(q, 'agent-2', 'active');
    const owners = [];
    for (const n of [1, 2, 3]) {
      const id = await record(q, call({ conversation_id: `conv_turn_${n}`, caller_phone: `+5068888000${n}` }));
      owners.push((await ownerAndQueue(q, id)).owner_id);
    }
    assert.deepEqual(owners, ['agent-1', 'agent-2', 'agent-1']);
  });
});

test('the call waits only when every agent is at their limit', async () => {
  await inTransaction(async (q) => {
    await makeAvailable(q, 'agent-1');
    await q(`UPDATE public.staff_profiles SET max_active_prospects = 0 WHERE id = 'agent-1'`);
    const id = await record(q, call());
    assert.deepEqual(await ownerAndQueue(q, id), { owner_id: null, status: 'waiting' });
  });
});

test('the call fills empty customer fields and keeps the ones already set', async () => {
  await inTransaction(async (q) => {
    const [existing] = await q(
      `INSERT INTO public.prospects (business_name, phone, service_interest, owner_id)
       VALUES ('Panadería Sol', '8888-7777', 'Ya definido', 'agent-2') RETURNING id`
    );
    await record(q, call({ business_type: 'Panadería' }));
    const [row] = await q(
      `SELECT contact_name, business_category, service_interest FROM public.prospects WHERE id = $1`,
      [existing.id]
    );
    assert.deepEqual(row, {
      contact_name: 'Ana Mora',
      business_category: 'Panadería',
      service_interest: 'Ya definido',
    });
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

test('a different person on a known number becomes a new customer, without touching the other', async () => {
  await inTransaction(async (q) => {
    await makeAvailable(q, 'agent-1');
    const [pedro] = await q(
      `INSERT INTO public.prospects (business_name, contact_name, phone, owner_id)
       VALUES ('Hospitapiedras.com', 'Pedro Picapiedra', '50688887777', 'agent-2') RETURNING id`
    );
    const id = await record(q, call({ business_name: 'El Arbolito Feliz', business_type: 'Árboles' }));
    const [row] = await q(
      `SELECT r.prospect_id <> $2 AS separate, p.business_name, p.contact_name, p.owner_id
       FROM public.ai_call_requests r JOIN public.prospects p ON p.id = r.prospect_id WHERE r.id = $1`,
      [id, pedro.id]
    );
    assert.deepEqual(row, {
      separate: true,
      business_name: 'El Arbolito Feliz',
      contact_name: 'Ana Mora',
      owner_id: 'agent-1',
    });
    const [untouched] = await q(`SELECT business_category FROM public.prospects WHERE id = $1`, [pedro.id]);
    assert.equal(untouched.business_category, '');
  });
});

test('the same person calling again joins their customer, short name and accents included', async () => {
  await inTransaction(async (q) => {
    const [existing] = await q(
      `INSERT INTO public.prospects (business_name, contact_name, phone, owner_id)
       VALUES ('Panadería Sol', 'Ána Mora Solís', '8888-7777', 'agent-2') RETURNING id`
    );
    const id = await record(q, call({ customer_name: 'ana mora' }));
    const [row] = await q(`SELECT prospect_id FROM public.ai_call_requests WHERE id = $1`, [id]);
    assert.equal(row.prospect_id, existing.id);
  });
});

// The migration's one-time repair, replayed on the merged state seen in production on 2026-11-04.
const REPAIR = readFileSync(
  new URL('../../supabase/migrations/20261104200000_ai_calls_split_different_callers.sql', import.meta.url),
  'utf8'
).split('-- BEGIN repair')[1].split('-- END repair')[0];

test('the repair gives a merged caller their own customer with the same agent', async () => {
  await inTransaction(async (q) => {
    const [pedro] = await q(
      `INSERT INTO public.prospects (business_name, contact_name, phone, business_category, owner_id)
       VALUES ('Hospitapiedras.com', 'Pedro Picapiedra', '50681234567', 'venta de árboles', 'agent-2')
       RETURNING id`
    );
    const insertCall = (conversation, name, business, type) =>
      q(
        `INSERT INTO public.ai_call_requests
           (conversation_id, prospect_id, callback_phone, customer_name, business_name, business_type,
            call_started_at, status)
         VALUES ($1, $2, '81234567', $3, $4, $5, now(), 'in_progress') RETURNING id`,
        [conversation, pedro.id, name, business, type]
      ).then((rows) => rows[0].id);
    const pedroCall = await insertCall('conv_pedro', 'Pedro Picapiedra', 'Hospitapiedras.com', null);
    const juanCall = await insertCall('conv_juan', 'Juan López', 'El Arbolito Feliz', 'venta de árboles');

    await q(REPAIR);
    await q(REPAIR); // Re-running changes nothing.

    const rows = await q(
      `SELECT r.id, p.business_name, p.contact_name, p.business_category, p.owner_id, q.status AS queue
       FROM public.ai_call_requests r
       JOIN public.prospects p ON p.id = r.prospect_id
       JOIN public.assignment_queue q ON q.prospect_id = p.id
       WHERE r.id = $1`,
      [juanCall]
    );
    assert.deepEqual(rows, [
      {
        id: juanCall,
        business_name: 'El Arbolito Feliz',
        contact_name: 'Juan López',
        business_category: 'venta de árboles',
        owner_id: 'agent-2',
        queue: 'assigned',
      },
    ]);
    const [pedroAfter] = await q(
      `SELECT p.business_category, r.prospect_id = p.id AS kept
       FROM public.prospects p, public.ai_call_requests r WHERE p.id = $1 AND r.id = $2`,
      [pedro.id, pedroCall]
    );
    assert.deepEqual(pedroAfter, { business_category: '', kept: true });
    const [{ count }] = await q(`SELECT count(*)::int AS count FROM public.prospects`);
    assert.equal(count, 2);
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
