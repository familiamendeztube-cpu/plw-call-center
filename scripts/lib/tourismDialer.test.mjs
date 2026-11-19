import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './testDatabase.mjs';

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const at = '2026-11-10T15:00:00Z'; // Tuesday, inside 08:00-16:00 Costa Rica
let db;
before(async () => {
  db = await createTestDatabase();
});
after(async () => {
  await db?.close();
});

async function as(tx, i) {
  await tx.exec('RESET ROLE');
  await tx.query("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify(i === undefined ? {} : { sub: id(100 + i), session_id: id(200 + i) }),
  ]);
  await tx.exec(`SET LOCAL ROLE ${i === undefined ? 'service_role' : 'authenticated'}`);
}

async function denied(tx, sql, args, pattern) {
  await tx.exec('SAVEPOINT denied');
  await assert.rejects(tx.query(sql, args), pattern);
  await tx.exec('ROLLBACK TO SAVEPOINT denied');
}

async function fixture(work) {
  await db.transaction(async (tx) => {
    for (const [i, staff] of ['admin-1', 'agent-2'].entries()) {
      await tx.query('INSERT INTO auth.users(id) VALUES($1)', [id(100 + i)]);
      await tx.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)', [id(200 + i), id(100 + i)]);
      await tx.query('UPDATE staff_profiles SET auth_user_id=$1,is_enabled=true WHERE id=$2', [
        id(100 + i),
        staff,
      ]);
    }
    await tx.query(
      "UPDATE staff_presence SET availability='active',operational=NULL,last_heartbeat_at=$1 WHERE staff_id='agent-2'",
      [at]
    );
    await work(tx);
    await tx.rollback();
  });
}

// A configured, verified and started dialer (the runtime row starts paused).
const READY =
  "UPDATE tourism_dialer_runtime SET scheduler_ready=true, paused=false, provider_agent_id='tourism_agent', transfer_uri='sip:agent-2@phone.example.com', config_verified_at=now()";

async function tourismCampaign(tx, name = 'Turismo PLW') {
  const campaignId = id(300 + (name === 'Turismo PLW' ? 0 : 1));
  await tx.query('INSERT INTO ai_outbound_campaigns(id,name) VALUES($1,$2)', [campaignId, name]);
  return campaignId;
}

async function lead(tx, campaignId, n, phone) {
  await tx.query(
    'INSERT INTO ai_outbound_leads(id,campaign_id,phone,contact_name,business_name,business_type) VALUES($1,$2,$3,$4,$5,$6)',
    [id(400 + n), campaignId, phone, 'Juan', `Tour ${n}`, 'tours']
  );
}

test('persisted tourism leads flow to the claim, counted, Alejandro only', async () =>
  fixture(async (tx) => {
    const campaignId = await tourismCampaign(tx);
    await lead(tx, campaignId, 0, '22221100');
    await lead(tx, campaignId, 1, '22221101');
    await tx.exec(
      READY
    );
    await as(tx);
    const first = (await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data;
    assert.equal(first.lead.phone, '22221100');
    assert.equal(first.call.staff_id, 'agent-2');
    assert.equal(first.call.provider_agent_id, 'tourism_agent');
    const counted = (await tx.query('SELECT dialed_today FROM tourism_dialer_runtime')).rows[0];
    assert.equal(counted.dialed_today, 1);
    // In-flight call holds the single shared line.
    assert.equal((await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data, null);
    await tx.query("UPDATE tourism_calls SET state='completed' WHERE id=$1", [first.call.id]);
    const next = (await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data;
    assert.equal(next.lead.phone, '22221101');
    // The called lead is never dialed twice.
    await tx.query("UPDATE tourism_calls SET state='completed' WHERE id=$1", [next.call.id]);
    assert.equal((await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data, null);
  }));

test('claim skips other campaigns, DNC, dental in-flight phones and pending callbacks', async () =>
  fixture(async (tx) => {
    const campaignId = await tourismCampaign(tx);
    const otherId = await tourismCampaign(tx, 'Otra campaña');
    await lead(tx, otherId, 5, '22221105'); // wrong campaign: never claimed
    await lead(tx, campaignId, 0, '22221100');
    await lead(tx, campaignId, 1, '22221101');
    await lead(tx, campaignId, 2, '22221102');
    await lead(tx, campaignId, 3, '22221103');
    await tx.exec(
      READY
    );
    await as(tx);
    await tx.query('INSERT INTO ai_outbound_do_not_call(phone) VALUES ($1)', ['22221100']);
    await tx.query(
      "INSERT INTO dental_calls(is_test,staff_id,phone,provider_agent_id,transfer_uri,state) VALUES(true,'agent-1','22221102','dental_agent-1','sip:agent-1@phone.example.com','started')"
    );
    let call = (await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data;
    assert.equal(call, null); // a dental call in flight holds the shared line
    await tx.query("UPDATE dental_calls SET state='completed' WHERE staff_id='agent-1'");
    call = (await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data;
    assert.equal(call.lead.phone, '22221101'); // DNC 100 skipped, other campaign skipped
    await tx.query(
      "INSERT INTO tourism_callbacks(call_id,lead_id,phone,scheduled_for) VALUES($1,$2,'22221101',now()+interval '1 day')",
      [call.call.id, call.lead.id]
    );
    await tx.query("UPDATE tourism_calls SET state='completed' WHERE id=$1", [call.call.id]);
    // Pending callback protects lead 1; the next free lead is dialed.
    const last = (await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data;
    assert.equal(last.lead.phone, '22221102');
  }));

test('out of window, offline agent, cap and missing agent config refuse to claim', async () =>
  fixture(async (tx) => {
    const campaignId = await tourismCampaign(tx);
    await lead(tx, campaignId, 0, '22221100');
    await tx.exec(
      READY
    );
    await as(tx);
    assert.equal((await tx.query('SELECT claim_tourism_call($1) AS data', ['2026-11-14T15:00:00Z'])).rows[0].data, null);
    await tx.exec("UPDATE staff_presence SET last_heartbeat_at='2026-11-09' WHERE staff_id='agent-2'");
    assert.equal((await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data, null); // offline agent
    await tx.query("UPDATE staff_presence SET last_heartbeat_at=$1 WHERE staff_id='agent-2'", [at]);
    const ok = (await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data;
    assert.equal(ok.lead.phone, '22221100');
    await tx.query("UPDATE tourism_calls SET state='completed' WHERE id=$1", [ok.call.id]);
    await tx.query('UPDATE tourism_dialer_runtime SET dialed_today=100 WHERE id=1');
    assert.equal((await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data, null); // daily cap
    await tx.query('UPDATE tourism_dialer_runtime SET dialed_today=0 WHERE id=1');
    await tx.query("UPDATE tourism_dialer_runtime SET provider_agent_id=NULL WHERE id=1");
    assert.equal((await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data, null); // unverified config
  }));

test('the dialer starts paused, and clearing an error never resumes it; only Iniciar does', async () =>
  fixture(async (tx) => {
    const campaignId = await tourismCampaign(tx);
    await lead(tx, campaignId, 0, '22221100');
    // Configured and verified, but nobody pressed Iniciar yet.
    await tx.exec(
      "UPDATE tourism_dialer_runtime SET scheduler_ready=true, provider_agent_id='tourism_agent', transfer_uri='sip:agent-2@phone.example.com', config_verified_at=now()"
    );
    await as(tx, 0);
    assert.deepEqual((await tx.query('SELECT scheduler_ready,paused FROM tourism_dialer_runtime')).rows, [
      { scheduler_ready: true, paused: true },
    ]);
    await denied(tx, 'UPDATE tourism_dialer_runtime SET paused=false WHERE id=1', [], /permission denied/);
    await denied(tx, "INSERT INTO tourism_calls(staff_id,phone,provider_agent_id) VALUES('agent-2','22221100','x')", [], /permission denied/);
    await denied(tx, 'SELECT enable_tourism_scheduler()', [], /permission denied/);
    await as(tx);
    assert.equal((await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data, null);
    // What Configurar/Reconfigurar and the heartbeat write: the pause survives.
    await tx.query("UPDATE tourism_dialer_runtime SET last_error='', last_tick_at=now() WHERE id=1");
    assert.equal((await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data, null);
    // Start needs a verified voice and a fresh heartbeat.
    await tx.query('UPDATE tourism_dialer_runtime SET last_tick_at=now() - interval \'1 hour\' WHERE id=1');
    await as(tx, 0);
    await denied(tx, "SELECT control_tourism_dialer('start')", [], /antes de activar/);
    await tx.exec('RESET ROLE');
    await tx.query('UPDATE tourism_dialer_runtime SET last_tick_at=now() WHERE id=1');
    await as(tx, 1);
    await denied(tx, "SELECT control_tourism_dialer('start')", [], /Solo administración/);
    await as(tx, 0);
    await tx.query("SELECT control_tourism_dialer('start')");
    await as(tx);
    assert.equal((await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data.lead.phone, '22221100');
    await as(tx, 0);
    await tx.query("SELECT control_tourism_dialer('pause')");
    assert.equal((await tx.query('SELECT paused FROM tourism_dialer_runtime')).rows[0].paused, true);
    await as(tx, 1);
    await denied(tx, 'SELECT claim_tourism_call($1)', [at], /permission denied/);
  }));

test('a confirmed callback is dialed once when due; an opted-out number is never called back', async () =>
  fixture(async (tx) => {
    const campaignId = await tourismCampaign(tx);
    await lead(tx, campaignId, 0, '22221100');
    await lead(tx, campaignId, 1, '22221101');
    await lead(tx, campaignId, 2, '22221102');
    await tx.exec(READY);
    await as(tx);
    const first = (await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data;
    await tx.query("UPDATE tourism_calls SET state='completed' WHERE id=$1", [first.call.id]);
    // Lead 0 agreed to a callback in one hour; lead 1 answered and later opted out.
    await tx.query(
      "INSERT INTO tourism_callbacks(call_id,lead_id,phone,scheduled_for) VALUES($1,$2,'22221100',$3::timestamptz + interval '1 hour')",
      [first.call.id, first.lead.id, at]
    );
    const second = (await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data;
    assert.equal(second.lead.phone, '22221101');
    await tx.query("UPDATE tourism_calls SET state='completed' WHERE id=$1", [second.call.id]);
    await tx.query(
      "INSERT INTO tourism_callbacks(call_id,lead_id,phone,scheduled_for) VALUES($1,$2,'22221101',$3)",
      [second.call.id, second.lead.id, at]
    );
    await tx.query("INSERT INTO ai_outbound_do_not_call(phone) VALUES('22221101')");
    // Not due yet for lead 0, opted out for lead 1: the fresh lead 2 is next.
    const third = (await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data;
    assert.equal(third.lead.phone, '22221102');
    assert.equal(third.callback, undefined);
    await tx.query("UPDATE tourism_calls SET state='completed' WHERE id=$1", [third.call.id]);
    const later = new Date(Date.parse(at) + 61 * 60_000).toISOString();
    await tx.query("UPDATE staff_presence SET last_heartbeat_at=$1 WHERE staff_id='agent-2'", [later]);
    const callback = (await tx.query('SELECT claim_tourism_call($1) AS data', [later])).rows[0].data;
    assert.equal(callback.lead.phone, '22221100');
    assert.equal(callback.call.phone, '22221100');
    assert.ok(callback.callback);
    await tx.query("UPDATE tourism_calls SET state='completed' WHERE id=$1", [callback.call.id]);
    // Exactly once: nothing left to dial.
    assert.equal((await tx.query('SELECT claim_tourism_call($1) AS data', [later])).rows[0].data, null);
    assert.deepEqual(
      (await tx.query('SELECT phone,status FROM tourism_callbacks ORDER BY phone')).rows,
      [
        { phone: '22221100', status: 'done' },
        { phone: '22221101', status: 'cancelled' },
      ]
    );
  }));

test('an interested tourism call becomes one customer for Alejandro with a pending request', async () =>
  fixture(async (tx) => {
    const campaignId = await tourismCampaign(tx);
    await lead(tx, campaignId, 0, '22221100');
    await lead(tx, campaignId, 1, '22221101');
    await as(tx);
    const call = async (n, outcome, conversation) =>
      (
        await tx.query(
          `INSERT INTO tourism_calls(lead_id,campaign_id,staff_id,phone,provider_agent_id,conversation_id,state,finished_at,outcome,details,summary)
           VALUES($1,$2,'agent-2',$3,'tourism_agent',$4,'completed',now(),$5,$6,'Resumen')
           RETURNING id`,
          [
            id(400 + n),
            campaignId,
            `2222110${n}`,
            conversation,
            outcome,
            JSON.stringify({ contact_name: 'Ana', contact_email: 'ana@tour.cr', interest: 'Reservas en inglés' }),
          ]
        )
      ).rows[0].id;
    const toCustomer = async (callId) =>
      (await tx.query('SELECT tourism_call_to_customer($1) AS id', [callId])).rows[0].id;

    const interested = await call(0, 'EMAIL_INFO_REQUESTED', 'conv_tourism_0');
    const request = await toCustomer(interested);
    assert.ok(request);
    assert.equal(await toCustomer(interested), request); // idempotent per conversation
    await tx.exec('RESET ROLE');
    const [prospect] = (
      await tx.query("SELECT owner_id,phone,source,business_category FROM prospects WHERE idempotency_key=$1", [
        `tourism:${id(400)}`,
      ])
    ).rows;
    assert.deepEqual(prospect, { owner_id: 'agent-2', phone: '22221100', source: 'ai_call', business_category: 'tours' });
    const [row] = (await tx.query('SELECT preferred_contact,reason,status FROM ai_call_requests WHERE id=$1', [request])).rows;
    assert.equal(row.preferred_contact, 'email');
    assert.match(row.reason, /Correo: ana@tour\.cr/);
    assert.equal(row.status, 'pending');

    await as(tx);
    const declined = await call(1, 'NOT_INTERESTED', 'conv_tourism_1');
    assert.equal(await toCustomer(declined), null);
    await tx.exec('RESET ROLE');
    assert.equal((await tx.query('SELECT count(*)::int n FROM prospects WHERE source=$1', ['ai_call'])).rows[0].n, 1);
    await as(tx, 1);
    await denied(tx, 'SELECT tourism_call_to_customer($1)', [interested], /permission denied/);
  }));
