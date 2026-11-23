import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './testDatabase.mjs';
import { candidateSlots } from '../../supabase/functions/plw-hotel-demo/rules.ts';

// The public hotel demo link: one per hotel, the receptionist context plus booking five
// minutes with Alejandro. Collision safety, idempotency and the single demo_agendada row
// are the guarantees under test — the same ones the live link depends on.

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const PROSPECT = id(700);

let db;
before(async () => {
  db = await createTestDatabase();
});
after(async () => {
  await db?.close();
});

async function asService(tx) {
  await tx.exec('RESET ROLE');
  await tx.query("SELECT set_config('request.jwt.claims','',true)");
  await tx.exec('SET LOCAL ROLE service_role');
}

async function asStaff(tx, n) {
  await tx.exec('RESET ROLE');
  await tx.query(
    "SELECT set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ sub: id(800 + n), session_id: id(900 + n) })]
  );
  await tx.exec('SET LOCAL ROLE authenticated');
}

async function asAnon(tx) {
  await tx.exec('RESET ROLE');
  await tx.query("SELECT set_config('request.jwt.claims','',true)");
  await tx.exec('SET LOCAL ROLE anon');
}

async function denied(tx, sql, args, pattern) {
  await tx.exec('SAVEPOINT denied');
  await assert.rejects(tx.query(sql, args), pattern);
  await tx.exec('ROLLBACK TO SAVEPOINT denied');
}

function nextSlot() {
  // First Mon-Fri 08:00-14:00 CR instant at a 5-minute step, at least 2 hours out. Ending at
  // 14:00 leaves room for the tests' "+30 / +60 minutes" slots to stay inside the window.
  const now = new Date();
  for (let day = 0; day < 10; day += 1) {
    const dayUtc = new Date(now.getTime() + day * 86_400_000);
    dayUtc.setUTCHours(14, 0, 0, 0); // 08:00 CR
    const weekday = dayUtc.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (let minutes = 0; minutes <= 6 * 60; minutes += 5) {
      const slot = new Date(dayUtc.getTime() + minutes * 60_000);
      if (slot.getTime() > now.getTime() + 2 * 3_600_000) return slot.toISOString();
    }
  }
  throw new Error('no slot found');
}

// PGlite hands a composite function result back as its text form, so capture the link
// through to_jsonb: exactly what the staff UI does. Browser roles have no table grants
// by design — the RPC return is the only path to the token.
async function newLink(tx, prospectId) {
  const { rows } = await tx.query(
    'SELECT to_jsonb(ensure_tourism_hotel_demo_link($1)) AS j',
    [prospectId]
  );
  return { id: rows[0].j.id, token: rows[0].j.token };
}

async function currentLink(tx, prospectId) {
  const { rows } = await tx.query(
    'SELECT to_jsonb(rotate_tourism_hotel_demo_token($1)) AS j',
    [prospectId]
  );
  return { id: rows[0].j.id, token: rows[0].j.token };
}

async function staffFixture(tx) {
  for (const [i, staff] of ['admin-1', 'agent-2'].entries()) {
    await tx.query('INSERT INTO auth.users(id) VALUES($1)', [id(800 + i)]);
    await tx.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)', [id(900 + i), id(800 + i)]);
    await tx.query('UPDATE staff_profiles SET auth_user_id=$1,is_enabled=true WHERE id=$2', [
      id(800 + i),
      staff,
    ]);
  }
  await tx.query(
    "INSERT INTO prospects(id,business_name,phone,owner_id,idempotency_key) VALUES($1,'Hotel Prueba','26551234','agent-2','hotel:qa')",
    [PROSPECT]
  );
}

async function fixture(work) {
  await db.transaction(async (tx) => {
    await staffFixture(tx);
    await work(tx);
    await tx.rollback();
  });
}

test('a staff member creates exactly one link; rotate keeps the row and changes the token', async () =>
  fixture(async (tx) => {
    await asStaff(tx, 1);
    const first = await newLink(tx, PROSPECT);
    assert.match(first.token, /^[0-9a-f]{48}$/);
    const again = await newLink(tx, PROSPECT);
    assert.equal(again.id, first.id);
    assert.equal(again.token, first.token);
    // A minimal site draft came into being for the receptionist context.
    const draft = (
      await tx.query('SELECT business_name, preview_token FROM prospect_site_drafts WHERE prospect_id=$1', [PROSPECT])
    ).rows[0];
    assert.equal(draft.business_name, 'Hotel Prueba');
    assert.ok(draft.preview_token);

    const rotated = await currentLink(tx, PROSPECT);
    assert.equal(rotated.id, first.id);
    assert.notEqual(rotated.token, first.token);
    // Still exactly one link row (the upsert reused it); read as the service role,
    // which is the only role with table grants by design.
    await asService(tx);
    assert.equal((await tx.query('SELECT count(*)::int n FROM tourism_hotel_demo_links')).rows[0].n, 1);
  }));

test('an agent without access cannot touch another agent client link or booking', async () =>
  fixture(async (tx) => {
    await tx.query(
      "INSERT INTO prospects(id,business_name,owner_id,idempotency_key) VALUES($1,'Ajeno','agent-1','hotel:ajeno')",
      [id(701)]
    );
    await asStaff(tx, 1);
    await denied(tx, 'SELECT ensure_tourism_hotel_demo_link($1)', [id(701)], /Solo el agente asignado/);
    await denied(tx, 'SELECT book_tourism_demo_as_staff($1, now())', [id(701)], /Solo el agente asignado/);
    // Rotating a link that does not exist fails cleanly before the access check.
    await denied(tx, 'SELECT rotate_tourism_hotel_demo_token($1)', [id(701)], /todav.a no existe/);
  }));

test('anonymous callers can only book and cancel through the token, never read the tables', async () =>
  fixture(async (tx) => {
    await asStaff(tx, 1);
    const link = await newLink(tx, PROSPECT);
    await asAnon(tx);    // The token-scoped functions work, with or without the plw- prefix.
    const slot = nextSlot();
    const booked = (
      await tx.query('SELECT book_tourism_demo_from_link($1,$2,$3) AS b', [link.token, slot, 'link:qa:booking-1'])
    ).rows[0].b;
    assert.equal(booked.duplicate, false);
    const mine = (
      await tx.query('SELECT book_tourism_demo_from_link($1,$2,$3) AS b', [
        'plw-' + link.token, slot, 'link:qa:booking-1',
      ])
    ).rows[0].b;
    assert.equal(mine.duplicate, true); // idempotent by key
  }));

test('slot rules: off-window and near-past times are refused; valid ones book once', async () =>
  fixture(async (tx) => {
    await asStaff(tx, 1);
    const link = await newLink(tx, PROSPECT);
    await asAnon(tx);
    for (const bad of [
      '2026-11-29T15:00:00Z', // Sunday
      '2026-11-30T13:55:00Z', // 7:55am CR, before 8
      '2026-11-30T22:30:00Z', // 4:30pm CR, after 16
      new Date(Date.now() + 20 * 60_000).toISOString(), // less than an hour ahead
    ]) {
      await denied(
        tx,
        'SELECT book_tourism_demo_from_link($1,$2,$3)',
        [link.token, bad, `link:qa:bad-${bad}`],
        /Horario no disponible/
      );
    }
    const slot = nextSlot();
    const ok = (
      await tx.query('SELECT book_tourism_demo_from_link($1,$2,$3) AS b', [link.token, slot, 'link:qa:ok'])
    ).rows[0].b;
    assert.equal(ok.duplicate, false);
    // A different key on the same slot collides (the advisory lock plus re-check).
    await denied(
      tx,
      'SELECT book_tourism_demo_from_link($1,$2,$3)',
      [link.token, slot, 'link:qa:ok-2'],
      /acaba de ocuparse/
    );
  }));

test('a hotel reschedule keeps one active booking and the demo_agendada milestone stays single', async () =>
  fixture(async (tx) => {
    await asStaff(tx, 1);
    const link = await newLink(tx, PROSPECT);
    await asAnon(tx);
    const first = nextSlot();
    const second = new Date(Date.parse(first) + 30 * 60_000).toISOString();
    await tx.query('SELECT book_tourism_demo_from_link($1,$2,$3,$4,$5)', [
      link.token, first, 'link:qa:r1', 'Ana', 'Frente al Parque',
    ]);
    const rebook = (
      await tx.query('SELECT book_tourism_demo_from_link($1,$2,$3) AS b', [link.token, second, 'link:qa:r2'])
    ).rows[0].b;
    assert.equal(rebook.duplicate, false);
    assert.ok(rebook.booking_id);
    // Exactly one demo_agendada row, pointing at the newest slot.
    await asService(tx);
    const milestones = (
      await tx.query("SELECT due_at, slot_confirmed, source FROM tourism_milestones WHERE milestone='demo_agendada'")
    ).rows;
    assert.equal(milestones.length, 1);
    assert.equal(new Date(milestones[0].due_at).getTime(), Date.parse(second));
    assert.equal(milestones[0].slot_confirmed, true);
    // The owner cancels their own booking; cancelling twice fails cleanly.
    await asAnon(tx);
    await tx.query('SELECT cancel_tourism_demo_booking($1,$2)', [link.token, rebook.booking_id]);
    await denied(
      tx,
      'SELECT cancel_tourism_demo_booking($1,$2)',
      [link.token, rebook.booking_id],
      /Reserva no encontrada/
    );
    // Verify the visible states as the service role (no browser role has table grants).
    await asService(tx);
    const finalBookings = (await tx.query('SELECT status, guest_name FROM tourism_demo_bookings ORDER BY slot_start')).rows;
    assert.deepEqual(finalBookings, [
      { status: 'cancelled', guest_name: 'Ana' },
      { status: 'cancelled', guest_name: '' },
    ]);
    // The cancelled time leaves Hitos, and Alejandro reads the cancellation in the activity
    // (read as the owner: the service role has no grant on activity_events).
    await tx.exec('RESET ROLE');
    assert.equal(
      (await tx.query("SELECT count(*)::int n FROM tourism_milestones WHERE milestone='demo_agendada'")).rows[0].n,
      0
    );
    const notice = (
      await tx.query("SELECT agent_id FROM activity_events WHERE prospect_id=$1 AND summary LIKE 'El hotel canceló%'", [
        PROSPECT,
      ])
    ).rows;
    assert.deepEqual(notice, [{ agent_id: 'agent-2' }]);
    // Replaying the first key never resurrects the cancelled slot (as anon: the
    // public function is exactly what the link holder uses).
    await asAnon(tx);
    const replay = (
      await tx.query('SELECT book_tourism_demo_from_link($1,$2,$3) AS b', [link.token, first, 'link:qa:r1'])
    ).rows[0].b;
    assert.equal(replay.duplicate, true);
    assert.equal(replay.status, 'cancelled');
    // The owner cancels their own booking; cancelling twice fails cleanly.
  }));

test('an agent booking blocks the same slot for the hotel link, and vice versa', async () =>
  fixture(async (tx) => {
    await tx.query(
      "INSERT INTO prospects(id,business_name,phone,owner_id,idempotency_key) VALUES($1,'Otro Hotel','26559999','agent-2','hotel:qa2')",
      [id(702)]
    );
    await asStaff(tx, 1);
    const link = await newLink(tx, PROSPECT);
    const slot = nextSlot();
    await tx.query('SELECT book_tourism_demo_as_staff($1,$2)', [PROSPECT, slot]);
    await asAnon(tx);
    // The staff booking took (agent-2, slot): the public link cannot double-book it.
    await denied(
      tx,
      'SELECT book_tourism_demo_from_link($1,$2,$3)',
      [link.token, slot, 'link:qa:x1'],
      /acaba de ocuparse/
    );
    // And the other way around: another hotel's link holds slot2, so the agent cannot take it
    // for this hotel.
    const slot2 = new Date(Date.parse(slot) + 60 * 60_000).toISOString();
    await asStaff(tx, 1);
    const other = await newLink(tx, id(702));
    await asAnon(tx);
    await tx.query('SELECT book_tourism_demo_from_link($1,$2,$3)', [other.token, slot2, 'link:qa:x2']);
    await asStaff(tx, 1);
    await denied(tx, 'SELECT book_tourism_demo_as_staff($1,$2)', [PROSPECT, slot2], /ya está reservado/);
    await asService(tx);
    assert.equal(
      (await tx.query("SELECT count(*)::int n FROM tourism_demo_bookings WHERE status='booked'")).rows[0].n,
      2
    );
  }));

test('the agent changes a demo the hotel already booked: the newest time wins, once', async () =>
  fixture(async (tx) => {
    await asStaff(tx, 1);
    const link = await newLink(tx, PROSPECT);
    const first = nextSlot();
    const second = new Date(Date.parse(first) + 30 * 60_000).toISOString();
    await asAnon(tx);
    await tx.query('SELECT book_tourism_demo_from_link($1,$2,$3,$4)', [link.token, first, 'link:qa:h1', 'Ana']);
    await asStaff(tx, 1);
    // The hotel's own time again is a no-op that keeps the name the hotel typed.
    const same = (await tx.query('SELECT book_tourism_demo_as_staff($1,$2) AS b', [PROSPECT, first])).rows[0].b;
    // A new time replaces the hotel's booking instead of failing on the one-per-link index.
    await tx.query('SELECT book_tourism_demo_as_staff($1,$2)', [PROSPECT, second]);
    // Back to the first time: a new agent row, and the milestone follows every move.
    await tx.query('SELECT book_tourism_demo_as_staff($1,$2)', [PROSPECT, first]);
    await asService(tx);
    const rows = (
      await tx.query('SELECT id, slot_start, status, booked_by, guest_name FROM tourism_demo_bookings ORDER BY created_at, slot_start')
    ).rows;
    assert.equal(rows.find((row) => row.id === same).guest_name, 'Ana');
    const active = rows.filter((row) => row.status === 'booked');
    assert.equal(active.length, 1);
    assert.equal(new Date(active[0].slot_start).getTime(), Date.parse(first));
    assert.equal(active[0].booked_by, 'agent');
    const due = (
      await tx.query("SELECT due_at FROM tourism_milestones WHERE prospect_id=$1 AND milestone='demo_agendada'", [PROSPECT])
    ).rows;
    assert.equal(due.length, 1);
    assert.equal(new Date(due[0].due_at).getTime(), Date.parse(first));

    // An agent booking the same time again after it was cancelled revives that row.
    await tx.query("UPDATE tourism_demo_bookings SET status='cancelled' WHERE status='booked'");
    await asStaff(tx, 1);
    await tx.query('SELECT book_tourism_demo_as_staff($1,$2)', [PROSPECT, first]);
    await asService(tx);
    assert.equal(
      (await tx.query("SELECT count(*)::int n FROM tourism_demo_bookings WHERE status='booked'")).rows[0].n,
      1
    );
  }));

test('the agent card reads its hotel link through the RPC; other agents and anonymous get nothing', async () =>
  fixture(async (tx) => {
    await tx.query(
      "INSERT INTO prospects(id,business_name,owner_id,idempotency_key) VALUES($1,'Ajeno','agent-1','hotel:ajeno')",
      [id(701)]
    );
    await asStaff(tx, 1);
    assert.deepEqual((await tx.query('SELECT * FROM get_tourism_hotel_demo_link($1)', [PROSPECT])).rows, []);
    const link = await newLink(tx, PROSPECT);
    const mine = (await tx.query('SELECT * FROM get_tourism_hotel_demo_link($1)', [PROSPECT])).rows;
    assert.deepEqual(mine, [{ token: link.token, revoked_at: null }]);
    await asStaff(tx, 0); // the administrator creates one for agent-1's hotel
    await newLink(tx, id(701));
    await asStaff(tx, 1);
    assert.deepEqual((await tx.query('SELECT * FROM get_tourism_hotel_demo_link($1)', [id(701)])).rows, []);
    await asAnon(tx);
    await denied(tx, 'SELECT * FROM get_tourism_hotel_demo_link($1)', [PROSPECT], /permission denied/);
  }));

test('marking a tourism customer paid records one confirmation for the weekly funnel', async () =>
  fixture(async (tx) => {
    await asStaff(tx, 0);
    await tx.query("SELECT set_payment_status($1, 'paid')", [PROSPECT]);
    await tx.query("SELECT set_payment_status($1, 'paid')", [PROSPECT]); // no second event
    await tx.exec('RESET ROLE');
    const events = (
      await tx.query("SELECT agent_id FROM activity_events WHERE prospect_id=$1 AND summary LIKE 'Pago confirmado%'", [
        PROSPECT,
      ])
    ).rows;
    assert.deepEqual(events, [{ agent_id: 'agent-2' }]);
  }));

test('the hotel page offers the next 5 weekdays, every 30 minutes, 08:00-15:30 Costa Rica', () => {
  // Friday 2026-11-27 13:10 CR (19:10 UTC): Friday keeps 14:30 to 15:30 (an hour out), then
  // Monday to Thursday in full; the weekend is skipped.
  const now = new Date('2026-11-27T19:10:00Z');
  const taken = new Set([Date.parse('2026-11-30T15:00:00Z')]); // Monday 09:00 CR is booked
  const slots = candidateSlots(taken, now);
  assert.equal(slots[0], '2026-11-27T20:30:00Z');
  assert.ok(!slots.includes('2026-11-27T20:00:00Z'), 'within the hour is not offered');
  assert.ok(!slots.includes('2026-11-30T15:00:00Z'), 'a taken time is not offered');
  const days = new Set(slots.map((slot) => slot.slice(0, 10)));
  assert.deepEqual([...days], ['2026-11-27', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03']);
  assert.equal(slots.filter((slot) => slot.startsWith('2026-12-01')).length, 16);
  assert.equal(slots.at(-1), '2026-12-03T21:30:00Z'); // Thursday 15:30 CR
  // After 15:30 the day no longer counts toward the five.
  const late = candidateSlots(new Set(), new Date('2026-11-27T21:45:00Z'));
  assert.equal(new Set(late.map((slot) => slot.slice(0, 10))).size, 5);
  assert.ok(late[0].startsWith('2026-11-30T14:00'));
});

test('a bad or revoked token can never book', async () =>
  fixture(async (tx) => {
    await asStaff(tx, 1);
    const link = await newLink(tx, PROSPECT);
    await asService(tx);
    await tx.query('UPDATE tourism_hotel_demo_links SET revoked_at=now() WHERE id=$1', [link.id]);
    await asAnon(tx);
    await denied(
      tx,
      'SELECT book_tourism_demo_from_link($1,$2,$3)',
      [link.token, nextSlot(), 'link:qa:revoked'],
      /Enlace no disponible/
    );
    await asAnon(tx);
    await denied(
      tx,
      'SELECT book_tourism_demo_from_link($1,$2,$3)',
      ['f'.repeat(48), nextSlot(), 'link:qa:ghost'],
      /Enlace no disponible/
    );
    await denied(
      tx,
      'SELECT book_tourism_demo_from_link($1,$2,$3)',
      ['plw-short', nextSlot(), 'link:qa:short'],
      /Solicitud no válida/
    );
  }));
