import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from './testDatabase.mjs';

// The US campaign SQL (claim, test reservation, classification, do-not-call, customer,
// callbacks) against the real migrations. 2026-12-01 is a Tuesday.
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
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

const ADMIN = 0;
const AGENT = 1;

async function fixture(work) {
  await db.transaction(async (tx) => {
    for (const [i, staff] of ['admin-1', 'agent-2'].entries()) {
      await tx.query('INSERT INTO auth.users(id) VALUES($1)', [id(100 + i)]);
      await tx.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)', [id(200 + i), id(100 + i)]);
      await tx.query('UPDATE staff_profiles SET auth_user_id=$1,is_enabled=true WHERE id=$2', [id(100 + i), staff]);
    }
    const campaign = (await tx.query("SELECT id FROM us_campaigns WHERE name = 'EE. UU. · Negocios en español'")).rows[0].id;
    await work(tx, campaign);
    await tx.rollback();
  });
}

const READY = `UPDATE us_dialer_runtime SET scheduler_ready=true, paused=false, provider_agent_id='us_agent',
  transfer_uri='sip:agent-2@phone.example.com', config_verified_at=now(), caller_e164='+12135550100'`;

async function lead(tx, campaign, n, phone, timezone, extra = {}) {
  await tx.query(
    `INSERT INTO us_leads(id,campaign_id,raw_phone,phone_e164,dest,business_name,business_type,timezone,sms_mobile,sms_consent)
     VALUES($1,$2,$3,$3,'us',$4,$5,$6,$7,$8)`,
    [id(500 + n), campaign, phone, `Negocio ${n}`, extra.type ?? 'Restaurante', timezone, extra.mobile ?? '', extra.sms ?? false]
  );
}

/** Claims at `at` with Alejandro online, then finishes the call so the line is free again. */
async function claimAt(tx, at) {
  await tx.exec('RESET ROLE');
  await tx.query(
    "UPDATE staff_presence SET availability='active',operational=NULL,last_heartbeat_at=$1 WHERE staff_id='agent-2'",
    [at]
  );
  await as(tx);
  const claim = (await tx.query('SELECT claim_us_call($1) AS c', [at])).rows[0].c;
  await tx.exec('RESET ROLE');
  if (claim) await tx.query("UPDATE us_calls SET state='completed', finished_at=$2 WHERE id=$1", [claim.call.id, at]);
  return claim;
}

test('the US claim follows each business clock, skips do-not-call and dials a callback once', async () =>
  fixture(async (tx, campaign) => {
    await tx.exec(READY);
    await lead(tx, campaign, 1, '+13055550101', 'America/Los_Angeles');
    await lead(tx, campaign, 2, '+13055550102', ''); // zone unknown: both coasts must be open
    await lead(tx, campaign, 3, '+13055550103', 'America/New_York');
    await lead(tx, campaign, 4, '+13055550104', 'America/New_York');
    await tx.query("INSERT INTO ai_outbound_do_not_call(phone,reason) VALUES('+13055550103','Pidió no llamar')");

    // 08:30 New York, 05:30 Los Angeles: only the New York lead that did not opt out.
    assert.equal((await claimAt(tx, '2026-12-01T13:30:00Z')).lead.id, id(504));

    const call = (await tx.query('SELECT id FROM us_calls WHERE lead_id=$1', [id(504)])).rows[0].id;
    await tx.query(
      "INSERT INTO us_callbacks(id,call_id,lead_id,phone,scheduled_for,timezone) VALUES($1,$2,$3,'+13055550104','2026-12-01T16:00:00Z','America/New_York')",
      [id(700), call, id(504)]
    );
    // Noon New York: the due callback goes first and is closed as it is dialed.
    assert.equal((await claimAt(tx, '2026-12-01T17:00:00Z')).lead.id, id(504));
    assert.equal((await tx.query('SELECT status FROM us_callbacks WHERE id=$1', [id(700)])).rows[0].status, 'done');

    assert.equal((await claimAt(tx, '2026-12-01T17:01:00Z')).lead.id, id(501)); // 09:01 Los Angeles
    assert.equal((await claimAt(tx, '2026-12-01T17:02:00Z')).lead.id, id(502));
    assert.equal(await claimAt(tx, '2026-12-01T17:03:00Z'), null, 'the callback is not redialed; the opt-out never');
    assert.equal((await tx.query('SELECT dialed_today FROM us_dialer_runtime')).rows[0].dialed_today, 4);

    // Saturday: nobody.
    await tx.query("UPDATE us_leads SET dest='us' WHERE id=$1", [id(503)]);
    await tx.query('DELETE FROM ai_outbound_do_not_call');
    assert.equal(await claimAt(tx, '2026-12-05T17:00:00Z'), null);
  }));

test('nothing is claimed without the US number or with Alejandro offline', async () =>
  fixture(async (tx, campaign) => {
    await tx.exec(READY);
    await lead(tx, campaign, 1, '+13055550101', 'America/New_York');
    await tx.exec('UPDATE us_dialer_runtime SET caller_e164=NULL');
    assert.equal(await claimAt(tx, '2026-12-01T17:00:00Z'), null);
    await tx.exec(READY);
    await tx.exec("UPDATE staff_presence SET last_heartbeat_at='2026-12-01T16:00:00Z' WHERE staff_id='agent-2'");
    await as(tx);
    assert.equal((await tx.query("SELECT claim_us_call('2026-12-01T17:00:00Z') AS c")).rows[0].c, null);
  }));

test('an admin test call is reserved once per request and then dialed', async () =>
  fixture(async (tx) => {
    await tx.exec(READY);
    await as(tx, ADMIN);
    const reserve = (n, phone) => tx.query('SELECT reserve_us_test($1,$2) AS c', [id(600 + n), phone]);
    const first = (await reserve(0, '(305) 555-0199')).rows[0].c;
    assert.equal(first.claimed, true, 'the edge function dials only when claimed is true');
    assert.equal(first.call.phone, '+13055550199');
    assert.equal((await reserve(0, '305 555 0199')).rows[0].c.claimed, false, 'a repeated request is not dialed twice');
    await denied(tx, 'SELECT reserve_us_test($1,$2)', [id(601), '305 555 0199'], /pendientes de finalizar/);
    await denied(tx, 'SELECT reserve_us_test($1,$2)', [id(602), '809 555 0199'], /número de EE. UU./);

    await tx.exec('RESET ROLE');
    await tx.query("INSERT INTO ai_outbound_do_not_call(phone,reason) VALUES('+13055550188','x')");
    await tx.exec('UPDATE us_dialer_runtime SET caller_e164=NULL');
    await as(tx, ADMIN);
    await denied(tx, 'SELECT reserve_us_test($1,$2)', [id(603), '305 555 0177'], /Falta el número de EE. UU./);
    await tx.exec('RESET ROLE');
    await tx.exec(READY);
    await as(tx, ADMIN);
    await denied(tx, 'SELECT reserve_us_test($1,$2)', [id(604), '305 555 0188'], /bloqueado/);
    await as(tx, AGENT);
    await denied(tx, 'SELECT reserve_us_test($1,$2)', [id(605), '305 555 0166'], /administración/);
  }));

test('an imported list is classified by full number, with the safe zone when unknown', async () =>
  fixture(async (tx, campaign) => {
    await tx.query("INSERT INTO ai_outbound_do_not_call(phone,reason) VALUES('+13055550103','x')");
    await as(tx, ADMIN);
    const rows = [
      ['+1 (213) 555-0101', ''],
      ['213-555-0101', ''],
      ['8888-1234', ''],
      ['506 2222 3344', ''],
      ['+1 441 555 0101', ''],
      ['900 555 0101', ''],
      ['808 555 0101', ''],
      ['305 555 0103', ''],
      ['911 555 0101', ''],
      ['312 555 0101', 'America/Nowhere'],
      ['416 555 0101', ''],
    ];
    for (const [i, [phone, timezone]] of rows.entries())
      await tx.query(
        'INSERT INTO us_leads(id,campaign_id,raw_phone,timezone,created_at) VALUES($1,$2,$3,$4,$5)',
        [id(800 + i), campaign, phone, timezone, `2026-12-01T10:00:${String(i).padStart(2, '0')}Z`]
      );
    await tx.query('SELECT us_classify_lead_rows($1)', [campaign]);
    const result = (await tx.query('SELECT raw_phone, phone_e164, dest, timezone FROM us_leads ORDER BY created_at')).rows;
    assert.deepEqual(
      result.map((r) => [r.raw_phone, r.dest, r.phone_e164, r.timezone]),
      [
        ['+1 (213) 555-0101', 'us', '+12135550101', ''],
        ['213-555-0101', 'dup', '+12135550101', ''],
        ['8888-1234', 'cr', '+50688881234', ''],
        ['506 2222 3344', 'cr', '+50622223344', ''],
        ['+1 441 555 0101', 'other', '+14415550101', ''],
        ['900 555 0101', 'other', '+19005550101', ''],
        ['808 555 0101', 'us', '+18085550101', 'Pacific/Honolulu'],
        ['305 555 0103', 'dnc', '+13055550103', ''],
        ['911 555 0101', 'invalid', null, ''],
        ['312 555 0101', 'invalid', '+13125550101', 'America/Nowhere'],
        ['416 555 0101', 'ca', '+14165550101', ''],
      ]
    );
  }));

test('US opt-outs are saved and only admins mark or read US leads', async () =>
  fixture(async (tx, campaign) => {
    await lead(tx, campaign, 1, '+13055550101', 'America/New_York');
    await as(tx);
    // What the runner writes when a person asks not to be called again.
    await tx.query("INSERT INTO ai_outbound_do_not_call(phone,reason) VALUES('+13055550199','Solicitud de exclusión')");

    await as(tx, AGENT);
    assert.equal((await tx.query('SELECT count(*)::int AS n FROM us_leads')).rows[0].n, 0, 'agents do not see the US list');
    await denied(tx, 'SELECT us_mark_dnc($1)', [id(501)], /No autorizado/);

    await as(tx, ADMIN);
    await tx.query('SELECT us_mark_dnc($1)', [id(501)]);
    await tx.query('SELECT us_mark_dnc($1)', [id(501)]); // twice is fine
    assert.equal((await tx.query('SELECT dest FROM us_leads WHERE id=$1', [id(501)])).rows[0].dest, 'dnc');
    await tx.exec('RESET ROLE');
    assert.equal(
      (await tx.query("SELECT count(*)::int AS n FROM ai_outbound_do_not_call WHERE phone='+13055550101'")).rows[0].n,
      1
    );
  }));

test('an interested US call becomes a customer, a sample with its own template, and an SMS', async () =>
  fixture(async (tx, campaign) => {
    await lead(tx, campaign, 1, '+13055550101', 'America/New_York', { type: 'Restaurante mexicano', mobile: '+13105550123', sms: true });
    const insertCall = (n, outcome, ended) =>
      tx.query(
        `INSERT INTO us_calls(id,lead_id,campaign_id,staff_id,phone,provider_agent_id,conversation_id,state,outcome,ended_reason,details,summary,finished_at)
         VALUES($1,$2,$3,'agent-2','+13055550101','us_agent',$4,'completed',$5,$6,$7,'Quiere ver la muestra.',now())`,
        [id(900 + n), id(501), campaign, `conv_${n}`, outcome, ended, { contact_name: 'Ana', callback_phone: '305 555 0177' }]
      );
    await insertCall(0, 'VOICEMAIL', 'voicemail');
    await insertCall(1, 'INTERESTED_FOLLOW_UP', 'human');
    await as(tx);
    assert.equal((await tx.query('SELECT us_call_to_customer($1) AS r', [id(900)])).rows[0].r, null, 'a voicemail is not a customer');
    assert.ok((await tx.query('SELECT us_call_to_customer($1) AS r', [id(901)])).rows[0].r);

    await tx.exec('RESET ROLE');
    const request = (await tx.query("SELECT callback_phone, customer_name FROM ai_call_requests WHERE conversation_id='conv_1'")).rows[0];
    assert.deepEqual(request, { callback_phone: '+13055550177', customer_name: 'Ana' });
    const prospect = (await tx.query(`SELECT id, owner_id, phone FROM prospects WHERE idempotency_key='us:${id(501)}'`)).rows[0];
    assert.equal(prospect.owner_id, 'agent-2');

    await as(tx, ADMIN);
    const sample = (await tx.query('SELECT us_prepare_sample($1) AS s', [prospect.id])).rows[0].s;
    assert.equal(sample.reused, false);
    assert.equal((await tx.query('SELECT us_prepare_sample($1) AS s', [prospect.id])).rows[0].s.reused, true);
    await tx.exec('RESET ROLE');
    const draft = (await tx.query('SELECT site_slug, category FROM prospect_site_drafts WHERE prospect_id=$1', [prospect.id])).rows[0];
    assert.deepEqual(draft, { site_slug: 'plw-restaurant', category: 'restaurant' });

    await as(tx);
    const sms = (await tx.query("SELECT us_sms_send($1,'k1','Hola','https://x','https://x/secretaria','','MG1') AS s", [id(501)])).rows[0].s;
    assert.equal(sms.status, 'queued');
    assert.equal(sms.to_e164, '+13105550123', 'the function needs the number to send to');
  }));

test('a callback is rescheduled in the business local time, by admins only', async () =>
  fixture(async (tx, campaign) => {
    await lead(tx, campaign, 1, '+13055550101', 'America/Los_Angeles');
    await tx.query(
      `INSERT INTO us_calls(id,lead_id,campaign_id,staff_id,phone,provider_agent_id,state)
       VALUES($1,$2,$3,'agent-2','+13055550101','us_agent','completed')`,
      [id(900), id(501), campaign]
    );
    await tx.query(
      "INSERT INTO us_callbacks(id,call_id,lead_id,phone,scheduled_for,timezone) VALUES($1,$2,$3,'+13055550101','2026-12-01T17:00:00Z','America/Los_Angeles')",
      [id(700), id(900), id(501)]
    );
    await as(tx, AGENT);
    await denied(tx, 'SELECT reschedule_us_callback($1,$2)', [id(700), '2026-12-02T10:30'], /No autorizado/);
    await as(tx, ADMIN);
    await tx.query('SELECT reschedule_us_callback($1,$2)', [id(700), '2026-12-02T10:30']);
    await denied(tx, 'SELECT reschedule_us_callback($1,$2)', [id(700), 'mañana'], /no válida/);
    const when = (await tx.query("SELECT to_char(scheduled_for AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') AS t FROM us_callbacks")).rows[0].t;
    assert.equal(when, '2026-12-02 18:30', '10:30 in Los Angeles');
  }));
