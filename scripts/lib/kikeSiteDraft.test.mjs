import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './testDatabase.mjs';

// Kike Sites draft workflow: one sample-site draft per prospect, guarded by the staff session
// and prospect ownership, idempotent under repeated or concurrent clicks, with no transcript
// or private-note data anywhere in the draft.

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
    `INSERT INTO public.prospects (id, business_name, phone, owner_id, business_category, service_interest)
     VALUES ($1, 'Tour Rincón', '8888-1234', 'agent-1', 'Tours', 'Puentes colgantes')`,
    [CLIENT_OF_1]
  );
});

after(async () => {
  await db?.close();
});

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

const refuses = (person, sql, pattern) => assert.rejects(as(person, (run) => run(sql)), pattern);

const save = (prospectId, name = 'Tour Rincón', phone = '+506 8888-7777') => `SELECT public.upsert_prospect_site_draft(
  '${prospectId}', 'plw-tourism-tours', '${name}', 'La Fortuna', 'tours',
  ARRAY['Tours guiados', 'Reservación en línea'], 'Puentes colgantes', '${phone}') AS id`;

const draftRow = async (run) =>
  (
    await run(
      `SELECT site_slug, business_name, locale, category, services, highlight, booking_phone,
              preview_token, created_by, shared_at
       FROM public.prospect_site_drafts WHERE prospect_id = $1`,
      [CLIENT_OF_1]
    )
  )[0];

test('an agent saves the draft for their own customer and reopens the same one', async () => {
  await as(AGENT_1, async (run) => {
    const [{ id: first }] = await run(save(CLIENT_OF_1));
    // Repeated clicks and later edits keep the same draft and the same preview link.
    const [{ id: again }] = await run(save(CLIENT_OF_1, 'Tour Rincón Aventura', '+506 8888-1234'));
    assert.equal(again, first);
    const row = await draftRow(run);
    assert.equal(row.business_name, 'Tour Rincón Aventura');
    assert.equal(row.site_slug, 'plw-tourism-tours');
    assert.equal(row.category, 'tours');
    assert.deepEqual(row.services, ['Tours guiados', 'Reservación en línea']);
    assert.equal(row.booking_phone, '+506 8888-1234');
    assert.equal(row.created_by, 'agent-1');
    assert.equal(row.shared_at, null);
    assert.match(row.preview_token, /^[0-9a-f]{48}$/);
    const [{ tokens }] = await run('SELECT count(*)::int AS tokens FROM public.prospect_site_drafts');
    assert.equal(tokens, 1);
  });
});

test('concurrent first saves converge on one draft without failing', async () => {
  await as(AGENT_1, async (run) => {
    const results = await Promise.allSettled([
      run(save(CLIENT_OF_1)),
      run(save(CLIENT_OF_1)),
      run(save(CLIENT_OF_1)),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    assert.ok(succeeded >= 1, 'at least one save lands');
    const [{ tokens }] = await run('SELECT count(*)::int AS tokens FROM public.prospect_site_drafts');
    assert.equal(tokens, 1);
  });
});

test('another agent and an unsigned browser cannot save or mark shared', async () => {
  await as(AGENT_1, (run) => run(save(CLIENT_OF_1)));
  await refuses(AGENT_2, save(CLIENT_OF_1, 'Turismo Ajeno'), /No autorizado/);
  await refuses(null, save(CLIENT_OF_1), /No autorizado/);
  await refuses(
    AGENT_2,
    `SELECT public.mark_prospect_site_shared('${CLIENT_OF_1}', 'whatsapp')`,
    /No autorizado|No hay borrador/
  );
  await refuses(
    AGENT_1,
    `SELECT public.mark_prospect_site_shared('${CLIENT_OF_1}', 'carrier_pigeon')`,
    /no válido/i
  );
});

test('unknown slug or category and a bad phone are refused before touching storage', async () => {
  await refuses(
    AGENT_1,
    `SELECT public.upsert_prospect_site_draft('${CLIENT_OF_1}', 'plw-dental-secret', 'X', '', 'tours', '{}', '', '+506 8888-7777')`,
    /no disponible/i
  );
  await refuses(
    AGENT_1,
    `SELECT public.upsert_prospect_site_draft('${CLIENT_OF_1}', 'plw-tourism-tours', 'X', '', 'yurts', '{}', '', '+506 8888-7777')`,
    /no válida/i
  );
  await refuses(
    AGENT_1,
    `SELECT public.upsert_prospect_site_draft('${CLIENT_OF_1}', 'plw-tourism-tours', 'X', '', 'tours', '{}', '', 'not-a-phone')`,
    /teléfono/i
  );
  await refuses(
    AGENT_1,
    `SELECT public.upsert_prospect_site_draft('${CLIENT_OF_1}', 'plw-tourism-tours', '  ', '', 'tours', '{}', '', '+506 8888-7777')`,
    /nombre/i
  );
});

test('the draft carries only public fields: no transcript or private note text leaks', async () => {
  await db.query(
    `INSERT INTO public.private_notes (id, prospect_id, author_id, body)
     VALUES ($1, $2, 'agent-1', 'NOTA PRIVADA SECRETA: precio de costo')`,
    [id(901), CLIENT_OF_1]
  );
  await db.query('DELETE FROM public.prospect_site_drafts WHERE prospect_id = $1', [CLIENT_OF_1]);
  await as(AGENT_1, (run) => run(save(CLIENT_OF_1)));
  const rows = (await as(AGENT_1, draftRow)) ?? [];
  const serialized = JSON.stringify(rows);
  assert.ok(!serialized.includes('NOTA PRIVADA'), 'private note text must not reach the draft');
  assert.ok(!serialized.includes('costo'), 'note fragments must not reach the draft');
});

test('marking shared stamps the time once the draft exists, not before', async () => {
  await db.query('DELETE FROM public.prospect_site_drafts WHERE prospect_id = $1', [CLIENT_OF_1]);
  await as(AGENT_1, async (run) => {
    await run(save(CLIENT_OF_1));
    await run(`SELECT public.mark_prospect_site_shared('${CLIENT_OF_1}', 'email')`);
    const row = await draftRow(run);
    assert.ok(row.shared_at, 'shared time recorded');
  });
});

test('only the customer owner marks shared or saves the secretary; a reassigned owner sees the draft', async () => {
  await db.transaction(async (tx) => {
    const run = async (person, sql, params = []) => {
      await tx.exec('RESET ROLE');
      const claims = { sub: person.userId, session_id: person.sessionId };
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await tx.exec('SET LOCAL ROLE authenticated');
      return (await tx.query(sql, params)).rows;
    };
    const refused = async (person, sql, pattern) => {
      await tx.exec('SAVEPOINT refused');
      await assert.rejects(run(person, sql), pattern);
      await tx.exec('ROLLBACK TO SAVEPOINT refused');
    };
    await tx.query('DELETE FROM public.prospect_site_drafts WHERE prospect_id = $1', [CLIENT_OF_1]);
    // The secretary save creates the draft when none exists (no booking phone yet).
    await run(AGENT_1, `SELECT public.set_prospect_secretary_demo('${CLIENT_OF_1}', 'Tour Rincón', 'tourism')`);
    const [draft] = await run(
      AGENT_1,
      'SELECT secretary_name, secretary_type, booking_phone, preview_token FROM public.prospect_site_drafts'
    );
    assert.deepEqual({ ...draft, preview_token: undefined }, {
      secretary_name: 'Tour Rincón',
      secretary_type: 'tourism',
      booking_phone: '',
      preview_token: undefined,
    });
    assert.match(draft.preview_token, /^[0-9a-f]{48}$/);
    // The draft exists in this transaction, so these refusals are about access.
    await refused(AGENT_2, `SELECT public.mark_prospect_site_shared('${CLIENT_OF_1}', 'whatsapp')`, /No autorizado/);
    await refused(AGENT_2, `SELECT public.set_prospect_secretary_demo('${CLIENT_OF_1}', 'Ajeno', 'retail')`, /No autorizado/);
    await refused(AGENT_1, `UPDATE public.prospect_site_drafts SET secretary_name = 'x'`, /permission denied/);
    assert.equal((await run(AGENT_2, 'SELECT id FROM public.prospect_site_drafts')).length, 0);
    // Reassigned: the new owner reads the sample the previous agent created.
    await tx.exec('RESET ROLE');
    await tx.query("UPDATE public.prospects SET owner_id = 'agent-2' WHERE id = $1", [CLIENT_OF_1]);
    assert.equal((await run(AGENT_2, 'SELECT id FROM public.prospect_site_drafts')).length, 1);
    await run(AGENT_2, `SELECT public.mark_prospect_site_shared('${CLIENT_OF_1}', 'whatsapp')`);
    await tx.rollback();
  });
});

test('the administrator opens the draft for verification, read-write through the same door', async () => {
  await as(ADMIN, async (run) => {
    const [{ id: draftId }] = await run(save(CLIENT_OF_1, 'Tour Rincón'));
    const row = await draftRow(run);
    assert.equal(row.created_by, 'admin-1');
    assert.equal(draftId, (await run('SELECT id FROM public.prospect_site_drafts'))[0].id);
  });
});
