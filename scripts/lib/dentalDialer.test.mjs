import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './testDatabase.mjs';
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const at = '2026-11-10T15:00:00Z';
const people = ['admin-1', 'agent-2', 'agent-3'];
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
    for (let i = 0; i < people.length; i++) {
      await tx.query('INSERT INTO auth.users(id) VALUES($1)', [id(100 + i)]);
      await tx.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)', [
        id(200 + i),
        id(100 + i),
      ]);
      await tx.query('UPDATE staff_profiles SET auth_user_id=$1,is_enabled=true WHERE id=$2', [
        id(100 + i),
        people[i],
      ]);
    }
    for (const staff of people.slice(1)) {
      await tx.query(
        "INSERT INTO dental_agent_dialers(staff_id,provider_agent_id,caller_phone_number_id,voice_id,transfer_uri,config_verified_at,transfer_verified_at,state) VALUES($1,$2,'line','voice',$3,now(),now(),'running')",
        [staff, `dental_${staff}`, `sip:${staff}@phone.example.com`]
      );
      await tx.query(
        "UPDATE staff_presence SET availability='active',operational=NULL,last_heartbeat_at=$1 WHERE staff_id=$2",
        [at, staff]
      );
    }
    await tx.query(
      "INSERT INTO dental_campaigns(id,name,planned_start_at) VALUES($1,'Prueba',$2)",
      [id(1), at]
    );
    for (let n = 0; n < 10; n++)
      await tx.query(
        "INSERT INTO dental_leads(id,campaign_id,phone,business_name,source_url,source_name,source_checked_at,owner_staff_id) VALUES($1,$2,$3,'Clínica','https://example.org','Fuente','2026-11-10',$4)",
        [id(n + 10), id(1), `222211${String(n).padStart(2, '0')}`, n < 5 ? 'agent-2' : 'agent-3']
      );
    await work(tx);
    await tx.rollback();
  });
}
async function claim(tx, staff = 'agent-2', time = at) {
  return (await tx.query('SELECT claim_dental_call($1,$2) AS data', [staff, time])).rows[0].data;
}
test('two per agent, four total; uncertain reservations retain capacity and completed leads never redial', async () =>
  fixture(async (tx) => {
    await as(tx);
    const one = await claim(tx);
    assert.ok(one);
    assert.ok(await claim(tx));
    assert.equal(await claim(tx), null);
    assert.ok(await claim(tx, 'agent-3'));
    assert.ok(await claim(tx, 'agent-3'));
    assert.equal(await claim(tx, 'agent-3'), null);
    await tx.query("UPDATE dental_calls SET state='uncertain' WHERE id=$1", [one.call.id]);
    assert.equal(await claim(tx), null);
    await tx.query("UPDATE dental_calls SET state='completed' WHERE id=$1", [one.call.id]);
    assert.notEqual((await claim(tx)).lead.id, one.lead.id);
  }));
test('paused, offline, busy, out-of-hours and opted-out prospects cannot be dialed', async () =>
  fixture(async (tx) => {
    await as(tx);
    assert.equal(await claim(tx, 'agent-2', '2026-11-10T14:59:59Z'), null);
    assert.equal(await claim(tx, 'agent-2', '2026-11-14T16:00:00Z'), null);
    await tx.exec("UPDATE dental_agent_dialers SET state='paused' WHERE staff_id='agent-2'");
    assert.equal(await claim(tx), null);
    await tx.exec(
      "UPDATE dental_agent_dialers SET state='running' WHERE staff_id='agent-2';UPDATE staff_presence SET operational='in_call' WHERE staff_id='agent-2'"
    );
    assert.equal(await claim(tx), null);
    await tx.exec(
      "UPDATE staff_presence SET operational=NULL,last_heartbeat_at='2026-11-09' WHERE staff_id='agent-2'"
    );
    assert.equal(await claim(tx), null);
    await tx.query("UPDATE staff_presence SET last_heartbeat_at=$1 WHERE staff_id='agent-2'", [at]);
    await tx.exec(
      "INSERT INTO ai_outbound_do_not_call(phone) SELECT phone FROM dental_leads WHERE owner_staff_id='agent-2'"
    );
    assert.equal(await claim(tx), null);
  }));
test('admin activation requires transfer verification and a fresh server heartbeat; agents cannot dispatch or schedule', async () =>
  fixture(async (tx) => {
    await as(tx, 0);
    await denied(tx, "SELECT control_dental_dialer('agent-2','activate')", [], /señal reciente/);
    await tx.exec('RESET ROLE');
    await tx.exec(
      "UPDATE dental_dialer_runtime SET scheduler_ready=true,last_tick_at=now();UPDATE dental_agent_dialers SET transfer_verified_at=NULL WHERE staff_id='agent-2'"
    );
    await as(tx, 0);
    await denied(
      tx,
      "SELECT control_dental_dialer('agent-2','activate')",
      [],
      /confirmar una transferencia/
    );
    await tx.exec('RESET ROLE');
    await tx.exec(
      "UPDATE dental_agent_dialers SET transfer_verified_at=now() WHERE staff_id='agent-2'"
    );
    await as(tx, 0);
    await tx.exec(
      "SELECT control_dental_dialer('agent-2','activate');SELECT control_dental_dialer('agent-2','pause')"
    );
    assert.equal(
      (await tx.query("SELECT state FROM dental_agent_dialers WHERE staff_id='agent-2'")).rows[0]
        .state,
      'paused'
    );
    await as(tx, 1);
    await denied(
      tx,
      "SELECT control_dental_dialer('agent-2','activate')",
      [],
      /Solo administración/
    );
    await denied(tx, "SELECT claim_dental_call('agent-2')", [], /permission denied/);
    await denied(tx, 'SELECT enable_dental_scheduler()', [], /permission denied/);
  }));
test('test requests are idempotent, transcripts private and only the receiving agent can confirm', async () =>
  fixture(async (tx) => {
    await as(tx);
    const args = [id(500), 'agent-2', '22223333'];
    assert.equal(
      (await tx.query('SELECT reserve_dental_test($1,$2,$3) AS data', args)).rows[0].data.claimed,
      true
    );
    assert.equal(
      (await tx.query('SELECT reserve_dental_test($1,$2,$3) AS data', args)).rows[0].data.claimed,
      false
    );
    await denied(
      tx,
      'SELECT reserve_dental_test($1,$2,$3)',
      [id(500), 'agent-3', '22223333'],
      /Solicitud ya utilizada/
    );
    await tx.query(
      'UPDATE dental_calls SET transfer_status=\'requested\',transcript=\'[{"role":"agent","message":"Hola"}]\' WHERE id=$1',
      [id(500)]
    );
    await as(tx, 2);
    assert.equal((await tx.query('SELECT * FROM dental_calls')).rows.length, 0);
    assert.deepEqual(
      (await tx.query('SELECT staff_id FROM dental_agent_dialers')).rows.map((r) => r.staff_id),
      ['agent-3']
    );
    await denied(tx, 'SELECT confirm_dental_transfer($1)', [id(500)], /Solo el agente receptor/);
    await as(tx, 0);
    await denied(tx, 'SELECT confirm_dental_transfer($1)', [id(500)], /Solo el agente receptor/);
    await as(tx, 1);
    assert.equal(
      (await tx.query('SELECT transcript FROM dental_calls')).rows[0].transcript[0].message,
      'Hola'
    );
    await tx.query('SELECT confirm_dental_transfer($1)', [id(500)]);
    assert.equal(
      (await tx.query('SELECT transfer_status FROM dental_calls')).rows[0].transfer_status,
      'agent_confirmed'
    );
    await denied(tx, "UPDATE dental_calls SET transfer_status='none'", [], /permission denied/);
  }));

test('Alejandro pilot stops at 20 new attempts, preserves the twentieth dispatch and cannot be resumed past the cap', async () =>
  fixture(async (tx) => {
    await as(tx);
    for (let n = 0; n < 25; n++)
      await tx.query(
        "INSERT INTO dental_leads(id,campaign_id,phone,business_name,source_url,source_name,source_checked_at,owner_staff_id) VALUES($1,$2,$3,'Piloto','https://example.org','Fuente','2026-11-10','agent-2')",
        [id(600 + n), id(1), `223344${String(n).padStart(2, '0')}`]
      );
    const earlier = await claim(tx);
    await tx.query("UPDATE dental_calls SET state='completed' WHERE id=$1", [earlier.call.id]);
    await tx.exec(
      "UPDATE dental_agent_dialers SET pilot_call_limit=20,pilot_baseline_count=1,pilot_started_at=now(),transfer_verified_at=NULL WHERE staff_id='agent-2';UPDATE dental_dialer_runtime SET scheduler_ready=true,last_tick_at=now()"
    );
    await as(tx, 0);
    await tx.exec("SELECT control_dental_dialer('agent-2','activate')");
    assert.equal(
      (
        await tx.query(
          "SELECT transfer_verified_at FROM dental_agent_dialers WHERE staff_id='agent-2'"
        )
      ).rows[0].transfer_verified_at,
      null
    );
    await as(tx);
    const testArgs = [id(800), 'agent-2', '22223344'];
    await tx.query('SELECT reserve_dental_test($1,$2,$3)', testArgs);
    await tx.query("UPDATE dental_calls SET state='completed' WHERE id=$1", [id(800)]);
    for (let round = 0; round < 10; round++) {
      const a = await claim(tx),
        b = await claim(tx);
      assert.ok(a);
      assert.ok(b);
      if (round === 9) {
        assert.equal(await claim(tx), null);
        assert.equal(
          (await tx.query("SELECT state FROM dental_agent_dialers WHERE staff_id='agent-2'"))
            .rows[0].state,
          'running'
        );
      }
      await tx.query("UPDATE dental_calls SET state='started' WHERE id=$1", [a.call.id]);
      assert.equal(
        (await tx.query("SELECT state FROM dental_agent_dialers WHERE staff_id='agent-2'")).rows[0]
          .state,
        'running'
      );
      await tx.query("UPDATE dental_calls SET state='started' WHERE id=$1", [b.call.id]);
      assert.equal(
        (await tx.query("SELECT state FROM dental_agent_dialers WHERE staff_id='agent-2'")).rows[0]
          .state,
        round === 9 ? 'paused' : 'running'
      );
      await tx.query("UPDATE dental_calls SET state='completed' WHERE id=ANY($1::uuid[])", [
        [a.call.id, b.call.id],
      ]);
    }
    assert.equal(
      (
        await tx.query(
          "SELECT count(*)::int n FROM dental_calls WHERE staff_id='agent-2' AND NOT is_test"
        )
      ).rows[0].n,
      21
    );
    assert.equal(await claim(tx), null);
    assert.equal(
      (
        await tx.query(
          "SELECT transfer_verified_at FROM dental_agent_dialers WHERE staff_id='agent-2'"
        )
      ).rows[0].transfer_verified_at,
      null
    );
    assert.equal(
      (await tx.query("SELECT pilot_call_limit FROM dental_agent_dialers WHERE staff_id='agent-3'"))
        .rows[0].pilot_call_limit,
      null
    );
    await denied(
      tx,
      "INSERT INTO dental_calls(lead_id,staff_id,phone,provider_agent_id,transfer_uri) SELECT id,'agent-2',phone,'dental_agent-2','sip:agent-2@phone.example.com' FROM dental_leads WHERE owner_staff_id='agent-2' AND id NOT IN(SELECT lead_id FROM dental_calls WHERE lead_id IS NOT NULL) LIMIT 1",
      [],
      /límite/
    );
    await as(tx, 0);
    await denied(tx, "SELECT control_dental_dialer('agent-2','resume')", [], /límite/);
    await tx.exec('RESET ROLE');
    await tx.query("UPDATE dental_calls SET transfer_status='requested' WHERE id=$1", [
      earlier.call.id,
    ]);
    await as(tx, 1);
    await tx.query('SELECT confirm_dental_transfer($1)', [earlier.call.id]);
    assert.ok(
      (
        await tx.query(
          "SELECT transfer_verified_at FROM dental_agent_dialers WHERE staff_id='agent-2'"
        )
      ).rows[0].transfer_verified_at
    );
  }));
test('a number that does not exist gives the pilot attempt back once and marks the lead', async () =>
  fixture(async (tx) => {
    await as(tx);
    const bad = await claim(tx);
    const good = await claim(tx);
    await tx.exec(
      "UPDATE dental_agent_dialers SET pilot_call_limit=20,pilot_baseline_count=0 WHERE staff_id='agent-2'"
    );
    await tx.query(
      "UPDATE dental_calls SET state='failed',error='dial failed with 404 Not Found (SIP 404)' WHERE id=$1",
      [bad.call.id]
    );
    await tx.query("UPDATE dental_calls SET state='completed' WHERE id=$1", [good.call.id]);
    for (const callId of [bad.call.id, bad.call.id, good.call.id])
      await tx.query('SELECT dental_number_not_found($1)', [callId]);
    const one = async (sql, args) => (await tx.query(sql, args)).rows[0];
    // Refunded exactly once, and only for the failed call.
    assert.equal(
      Number((await one("SELECT pilot_baseline_count FROM dental_agent_dialers WHERE staff_id='agent-2'")).pilot_baseline_count),
      1
    );
    assert.equal((await one('SELECT status FROM dental_leads WHERE id=$1', [bad.lead.id])).status, 'wrong_number');
    assert.equal((await one('SELECT status FROM dental_leads WHERE id=$1', [good.lead.id])).status, 'pending');
    // Browsers can't hand out refunds.
    await as(tx, 0);
    await denied(tx, 'SELECT dental_number_not_found($1)', [bad.call.id], /permission denied/);
  }));
