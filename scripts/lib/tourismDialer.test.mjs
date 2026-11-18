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
      "UPDATE tourism_dialer_runtime SET scheduler_ready=true, provider_agent_id='tourism_agent', config_verified_at=now()"
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
      "UPDATE tourism_dialer_runtime SET scheduler_ready=true, provider_agent_id='tourism_agent', config_verified_at=now()"
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
      "UPDATE tourism_dialer_runtime SET scheduler_ready=true, provider_agent_id='tourism_agent', config_verified_at=now()"
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

test('browser reads the status but writes nothing; pause holds against the heartbeat marker', async () =>
  fixture(async (tx) => {
    const campaignId = await tourismCampaign(tx);
    await lead(tx, campaignId, 0, '22221100');
    await tx.exec("UPDATE tourism_dialer_runtime SET scheduler_ready=true, provider_agent_id='tourism_agent', config_verified_at=now(), last_error='scheduler_paused'");
    await as(tx, 0);
    const status = (await tx.query('SELECT scheduler_ready,last_error FROM tourism_dialer_runtime')).rows;
    assert.deepEqual(status, [{ scheduler_ready: true, last_error: 'scheduler_paused' }]);
    await denied(tx, "UPDATE tourism_dialer_runtime SET last_error='' WHERE id=1", [], /permission denied/);
    await denied(tx, "INSERT INTO tourism_calls(staff_id,phone,provider_agent_id) VALUES('agent-2','22221100','x')", [], /permission denied/);
    // Admin pause, then a service-role claim respects it even after the start marker.
    await tx.exec("SELECT control_tourism_dialer('pause')");
    await as(tx);
    assert.equal((await tx.query('SELECT claim_tourism_call($1) AS data', [at])).rows[0].data, null);
    // The heartbeat no longer wipes the pause.
    await tx.query("UPDATE tourism_dialer_runtime SET last_tick_at=now(), last_error='' WHERE id=1 AND last_error <> 'scheduler_paused'");
    const kept = (await tx.query('SELECT last_error FROM tourism_dialer_runtime')).rows[0];
    assert.equal(kept.last_error, 'scheduler_paused');
    // Start needs a fresh heartbeat, then clears the pause once.
    await as(tx, 0);
    await denied(tx, "SELECT control_tourism_dialer('start')", [], /señal|antes de activar|verificar/);
    await tx.exec('RESET ROLE');
    await tx.query("UPDATE tourism_dialer_runtime SET last_tick_at=now() WHERE id=1");
    await as(tx, 0);
    await tx.query("SELECT control_tourism_dialer('start')");
    assert.equal((await tx.query('SELECT last_error FROM tourism_dialer_runtime')).rows[0].last_error, '');
    await as(tx, 1);
    await denied(tx, "SELECT control_tourism_dialer('start')", [], /Solo administración/);
    await denied(tx, 'SELECT claim_tourism_call($1)', [at], /permission denied/);
  }));
