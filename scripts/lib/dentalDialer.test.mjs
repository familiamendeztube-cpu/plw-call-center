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
test('a dentist who did not pick up gets one more call on a later business day, never a third', async () =>
  fixture(async (tx) => {
    await as(tx);
    // First calls already made for agent-2's leads id(10)..id(13); id(14) was never called.
    const first = [
      [id(10), 'completed', 'NO_ANSWER', '', '2026-11-09T15:00:00Z'], // Monday: retry first
      [id(11), 'failed', null, 'dial failed with 480 Temporarily Unavailable (SIP 480)', '2026-11-09T16:00:00Z'],
      [id(12), 'failed', null, 'dial failed with 404 Not Found (SIP 404)', '2026-11-09T15:30:00Z'],
      [id(13), 'completed', 'NO_ANSWER', '', '2026-11-10T14:00:00Z'], // same day as the claims below
    ];
    for (const [lead, state, outcome, error, created] of first)
      await tx.query(
        "INSERT INTO dental_calls(lead_id,staff_id,phone,provider_agent_id,transfer_uri,state,outcome,error,created_at) SELECT id,'agent-2',phone,'dental_agent-2','sip:agent-2@phone.example.com',$2,$3,$4,$5 FROM dental_leads WHERE id=$1",
        [lead, state, outcome, error, created]
      );
    const next = async () => {
      const claimed = await claim(tx);
      if (claimed)
        await tx.query("UPDATE dental_calls SET state='completed' WHERE id=$1", [claimed.call.id]);
      return claimed && [claimed.lead.id, claimed.call.attempt];
    };
    assert.deepEqual(await next(), [id(10), 2]); // no answer, oldest first
    assert.deepEqual(await next(), [id(11), 2]); // phone off
    assert.deepEqual(await next(), [id(14), 1]); // then new dentists
    assert.equal(await next(), null); // never the 404 or a same-day retry
    await denied(
      tx,
      "INSERT INTO dental_calls(lead_id,staff_id,phone,provider_agent_id,transfer_uri,attempt) SELECT id,'agent-2',phone,'x','sip:agent-2@phone.example.com',2 FROM dental_leads WHERE id=$1",
      [id(10)],
      /duplicate key/
    );
  }));
test('new dentists with a landline are offered before mobiles, each group in order', async () =>
  fixture(async (tx) => {
    await as(tx);
    await tx.query("UPDATE dental_leads SET phone='60001111' WHERE id=$1", [id(10)]);
    await tx.query("UPDATE dental_leads SET phone='70001111' WHERE id=$1", [id(11)]);
    const order = [];
    for (let n = 0; n < 5; n++) {
      const claimed = await claim(tx);
      if (!claimed) break;
      order.push(claimed.lead.id);
      await tx.query("UPDATE dental_calls SET state='completed' WHERE id=$1", [claimed.call.id]);
    }
    assert.deepEqual(order, [id(12), id(13), id(14), id(10), id(11)]);
    assert.equal(await claim(tx), null);
  }));
test('a dentist who wanted something becomes one customer for the lead agent, with the call pending', async () =>
  fixture(async (tx) => {
    await as(tx);
    const one = async (sql, args) => (await tx.query(sql, args)).rows[0];
    const addCall = (lead, conversation, outcome, details = {}, extra = '') =>
      one(
        `INSERT INTO dental_calls(lead_id,staff_id,phone,provider_agent_id,transfer_uri,state,outcome,details,conversation_id,summary,finished_at${extra ? ',attempt' : ''})
         SELECT id,owner_staff_id,phone,'dental_x','sip:agent-2@phone.example.com','completed',$2,$3,$4,'Pidió precios.',now()${extra ? ',2' : ''}
         FROM dental_leads WHERE id=$1 RETURNING id`,
        [lead, outcome, JSON.stringify(details), conversation]
      ).then((row) => row.id);
    const toCustomer = (callId) =>
      one('SELECT dental_call_to_customer($1) AS id', [callId]).then((row) => row.id);
    // The server role can't read these tables directly; the checks read as the owner.
    const check = async (sql, args) => {
      await tx.exec('RESET ROLE');
      const row = await one(sql, args);
      await as(tx);
      return row;
    };

    // Agent-3's dentist asked for WhatsApp info: a customer for agent-3, never round-robin.
    const good = await addCall(id(15), 'conv_good', 'WHATSAPP_INFO_REQUESTED', {
      contact_name: 'Dra. Solís',
      contact_phone: '8888-7777',
      callback_time: 'mañana a las 10',
    });
    const request = await toCustomer(good);
    assert.ok(request);
    assert.equal(await toCustomer(good), request); // repeats change nothing
    const saved = await check(
      `SELECT r.status, r.preferred_contact, r.callback_phone, r.preferred_time, r.summary,
              p.owner_id, p.source, p.phone, p.contact_name, p.business_category
       FROM ai_call_requests r JOIN prospects p ON p.id = r.prospect_id WHERE r.id = $1`,
      [request]
    );
    assert.deepEqual(saved, {
      status: 'pending',
      preferred_contact: 'whatsapp',
      callback_phone: '88887777',
      preferred_time: 'mañana a las 10',
      summary: 'Pidió precios.',
      owner_id: 'agent-3',
      source: 'ai_call',
      phone: '22221105',
      contact_name: 'Dra. Solís',
      business_category: 'Clínica dental',
    });
    assert.equal(
      (await check("SELECT count(*)::int AS n FROM assignment_queue q JOIN prospects p ON p.id=q.prospect_id WHERE p.idempotency_key=$1 AND q.status='assigned' AND q.assigned_to='agent-3'", [`dental:${id(15)}`])).n,
      1
    );

    // Anna's second good call to the same dentist joins the same customer.
    const again = await addCall(id(15), 'conv_again', 'CALLBACK_REQUESTED', {}, 'retry');
    await toCustomer(again);
    assert.equal(
      (await check("SELECT count(DISTINCT prospect_id)::int AS n FROM ai_call_requests WHERE conversation_id IN ('conv_good','conv_again')")).n,
      1
    );

    // Voicemail and no-interest calls stay on the dentist list only.
    for (const [lead, outcome] of [[id(16), 'VOICEMAIL'], [id(17), 'NOT_INTERESTED']])
      assert.equal(await toCustomer(await addCall(lead, `conv_${outcome}`, outcome)), null);
    // A transfer counts even when the analysis has no outcome yet.
    const transfer = await addCall(id(18), 'conv_transfer', null);
    await tx.query("UPDATE dental_calls SET transfer_status='requested' WHERE id=$1", [transfer]);
    assert.ok(await toCustomer(transfer));

    // Agents see only their own dentist's request; browsers cannot create customers.
    await as(tx, 1);
    assert.equal((await one('SELECT count(*)::int AS n FROM ai_call_requests')).n, 0);
    await as(tx, 2);
    assert.equal((await one('SELECT count(*)::int AS n FROM ai_call_requests')).n, 3);

    // Agent-3 corrects what the AI got wrong: the customer, its call cards and Anna's list agree.
    const { prospect_id } = await one('SELECT prospect_id FROM ai_call_requests WHERE id=$1', [request]);
    await tx.query(
      "SELECT set_prospect_details($1,' Clínica Dental Solís ','Dra. Ana Solís','88887777','Clínica dental','')",
      [prospect_id]
    );
    assert.deepEqual(
      await one('SELECT business_name, contact_name, phone FROM dental_leads WHERE id=$1', [id(15)]),
      { business_name: 'Clínica Dental Solís', contact_name: 'Dra. Ana Solís', phone: '22221105' }
    );
    assert.deepEqual(
      await one(
        "SELECT DISTINCT business_name, customer_name FROM ai_call_requests WHERE conversation_id IN ('conv_good','conv_again')"
      ),
      { business_name: 'Clínica Dental Solís', customer_name: 'Dra. Ana Solís' }
    );
    await denied(
      tx,
      "SELECT set_prospect_details($1,'','','','','')",
      [prospect_id],
      /obligatorio/
    );
    // Agent-2 can't touch agent-3's customer.
    await as(tx, 1);
    await denied(
      tx,
      "SELECT set_prospect_details($1,'Otro','','','','')",
      [prospect_id],
      /No autorizado/
    );
    await as(tx, 2);
    await denied(tx, 'SELECT dental_call_to_customer($1)', [good], /permission denied/);
  }));
test('the admin starts the next batch once the current one is used up, only under the activation rules', async () =>
  fixture(async (tx) => {
    await as(tx);
    const first = await claim(tx);
    await tx.query("UPDATE dental_calls SET state='completed' WHERE id=$1", [first.call.id]);
    await tx.exec(
      "UPDATE dental_agent_dialers SET pilot_call_limit=1,pilot_baseline_count=0,state='paused' WHERE staff_id='agent-2';UPDATE dental_dialer_runtime SET scheduler_ready=true,last_tick_at=now()"
    );
    const dialer = async () => {
      await tx.exec('RESET ROLE');
      const row = (
        await tx.query(
          "SELECT state,pilot_baseline_count::int AS baseline FROM dental_agent_dialers WHERE staff_id='agent-2'"
        )
      ).rows[0];
      await as(tx, 0);
      return row;
    };
    const next = "SELECT start_next_dental_batch('agent-2')";
    await as(tx, 1);
    await denied(tx, next, [], /Solo administración/);
    // Agent's app closed: refused, and the used-up batch stays as it was.
    await as(tx, 0);
    await denied(tx, next, [], /Activo/);
    assert.deepEqual(await dialer(), { state: 'paused', baseline: 0 });
    await tx.exec('RESET ROLE');
    await tx.exec("UPDATE staff_presence SET last_heartbeat_at=now() WHERE staff_id='agent-2'");
    await as(tx, 0);
    await tx.query(next);
    assert.deepEqual(await dialer(), { state: 'running', baseline: 1 });
    // The new batch has attempts left, so there is nothing to start yet.
    await denied(tx, next, [], /todavía tiene intentos/);
    await denied(tx, "SELECT start_next_dental_batch('agent-3')", [], /no trabaja por tandas/);
  }));
