import test from 'node:test';
import assert from 'node:assert/strict';
import { queueEligibility, validCall } from '../supabase/functions/asterisk-bridge/rules.js';

const now = Date.parse('2026-11-03T12:00:00Z');
const account = [{staff_id:'agent-9',sip_username:'agent-2'}];
const people = [{id:'agent-9',role:'agent',is_enabled:true}];
const fresh = {staff_id:'agent-9',availability:'active',operational:null,last_heartbeat_at:new Date(now-1000).toISOString()};
test('uses explicit staff-to-SIP mapping and fresh enabled availability',()=>{
  assert.deepEqual(queueEligibility(account,people,[fresh],now),[{username:'agent-2',available:true}]);
});
test('paused, stale, missing, disabled, future and after-call states fail closed',()=>{
  for(const change of [{availability:'paused'}, {operational:'after_call'}, {last_heartbeat_at:'bad'},
    {last_heartbeat_at:new Date(now-91000).toISOString()}, {last_heartbeat_at:new Date(now+6000).toISOString()}]) {
    assert.equal(queueEligibility(account,people,[{...fresh,...change}],now)[0].available,false);
  }
  assert.equal(queueEligibility(account,people,[],now)[0].available,false);
  assert.equal(queueEligibility(account,[{...people[0],is_enabled:false}],[fresh],now)[0].available,false);
});
test('in-call is left to Asterisk device state without hanging up',()=>{
  assert.equal(queueEligibility(account,people,[{...fresh,operational:'in_call'}],now)[0].available,true);
});
test('call validation rejects invalid attribution and malformed batches',()=>{
  const call={unique_id:'123.1.0',linked_id:'123.1',sip_username:'agent-1',direction:'outbound',number:'88888888',disposition:'ANSWERED',talk_seconds:10,started_at:'2026-11-03T12:00:00Z',ended_at:'2026-11-03T12:00:10Z'};
  assert.equal(validCall(call),true);
  for(const bad of [{talk_seconds:-1},{sip_username:'vocex'},{number:'<script>'},{ended_at:'bad'},{unique_id:''}]) assert.equal(!!validCall({...call,...bad}),false);
});

test('server call table refuses browser reads/writes and accepts idempotent server inserts', async()=>{
  const { PGlite } = await import('@electric-sql/pglite');
  const { readFile } = await import('node:fs/promises');
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE staff_profiles(id text PRIMARY KEY);');
    await db.exec(await readFile(new URL('../supabase/migrations/20261103172037_asterisk_server_call_records.sql',import.meta.url),'utf8'));
    for(const role of ['anon','authenticated']){
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query('SELECT * FROM asterisk_calls'), /permission denied/);
      await assert.rejects(db.query("INSERT INTO asterisk_calls(unique_id) VALUES ('x')"), /permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    const insert="INSERT INTO asterisk_calls(unique_id,linked_id,direction,number,disposition,talk_seconds,started_at,ended_at) VALUES ('1.1.1','1.1','inbound','','NO ANSWER',0,now(),now()) ON CONFLICT DO NOTHING";
    await db.exec(insert); await db.exec(insert);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM asterisk_calls')).rows[0].n,1);
  } finally { await db.close(); }
});
