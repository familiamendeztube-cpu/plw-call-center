import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dentalAgentConfig,
  safeAgent,
  conversationUpdate,
} from '../supabase/functions/dental-dialer/provider.js';
import { dispatchCall,syncCalls } from '../supabase/functions/dental-dialer/runner.js';
import { PLW_AGENT_ID } from '../supabase/functions/elevenlabs-webhook/rules.js';
const route = {
  staff_id: 'agent-2',
  provider_agent_id: 'dental_agent_2',
  caller_phone_number_id: 'line_dental',
  transfer_uri: 'sip:agent-2@phone.example.com',
};
const call = {
  id: 'test_call',
  staff_id: 'agent-2',
  is_test: true,
  phone: '22223333',
  provider_agent_id: route.provider_agent_id,
  conversation_id: 'conversation_test',
  transfer_status: 'none',
};
test('Ana accepts only her dental script, dedicated agent and fixed transfer destination', () => {
  const cfg = {
    agent_id: route.provider_agent_id,
    ...dentalAgentConfig('Alejandro', route, 'voice'),
  };
  assert.equal(safeAgent(cfg, route), true);
  for (const mutate of [
    (c) => {
      c.agent_id = PLW_AGENT_ID;
    },
    (c) => {
      c.conversation_config.agent.prompt.tool_ids = ['external'];
    },
    (c) => {
      c.conversation_config.agent.prompt.prompt = 'Wrong script';
    },
    (c) => {
      c.workflow = { nodes: { other: {} } };
    },
    (c) => {
      c.conversation_config.agent.prompt.built_in_tools.transfer_to_number.params.transfers[0].transfer_destination.sip_uri =
        'sip:agent-3@phone.example.com';
    },
  ]) {
    const other = structuredClone(cfg);
    mutate(other);
    assert.equal(safeAgent(other, route), false);
  }
});
test('exact conversation/agent/call matching is mandatory; a spoken promise is not a transfer', () => {
  const data = {
    agent_id: call.provider_agent_id,
    conversation_id: call.conversation_id,
    status: 'done',
    conversation_initiation_client_data: { dynamic_variables: { plw_dental_call_id: call.id } },
    transcript: [{ role: 'agent', message: 'Lo transfiero ahora.', time_in_call_secs: 10 }],
  };
  assert.equal(conversationUpdate(data, call).transfer_status, 'none');
  for (const key of ['agent_id', 'conversation_id'])
    assert.equal(conversationUpdate({ ...data, [key]: 'foreign' }, call), null);
  assert.equal(
    conversationUpdate({ ...data, conversation_initiation_client_data: {} }, call),
    null
  );
  data.transcript[0].tool_calls = [{ tool_name: 'transfer_to_number' }];
  assert.equal(conversationUpdate(data, call).transfer_status, 'requested');
  assert.equal(
    conversationUpdate(data, { ...call, transfer_status: 'agent_confirmed' }).transfer_status,
    'agent_confirmed'
  );
});
function fakeDb({ blocked = false, state = 'running' } = {}) {
  const writes = [];
  return {
    writes,
    from(table) {
      let update;
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        maybeSingle() {
          return Promise.resolve({
            data:
              table === 'ai_outbound_do_not_call'
                ? blocked
                  ? { phone: call.phone }
                  : null
                : { state },
            error: null,
          });
        },
        update(value) {
          update = value;
          return q;
        },
        then(resolve) {
          writes.push({ table, update });
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return q;
    },
  };
}
test('provider timeouts hold capacity as uncertain instead of authorizing a duplicate call', async () => {
  const db = fakeDb();
  let count = 0;
  await dispatchCall(db, 'test-key', { call, route, lead: {} }, async () => {
    count++;
    throw new Error('timeout');
  });
  assert.equal(count, 1);
  assert.equal(db.writes.at(-1).update.state, 'uncertain');
});
test('explicit provider acceptance uses the assigned agent and persists the conversation id', async () => {
  const db = fakeDb();
  let payload;
  await dispatchCall(
    db,
    'test-key',
    { call, route, lead: { business_name: 'Prueba' } },
    async (url, options) => {
      payload = JSON.parse(options.body);
      return Response.json({ success: true, conversation_id: 'conv123' });
    }
  );
  assert.equal(payload.agent_id, route.provider_agent_id);
  assert.equal(payload.to_number, '+50622223333');
  assert.equal(db.writes.at(-1).update.state, 'started');
  assert.equal(db.writes.at(-1).update.conversation_id, 'conv123');
});
test('opted-out numbers and a pause between reservation and dispatch never reach the provider', async () => {
  for (const options of [{ blocked: true }, { state: 'paused' }]) {
    const db = fakeDb(options);
    let count = 0;
    await dispatchCall(
      db,
      'test-key',
      { call: { ...call, is_test: false }, route, lead: {} },
      async () => {
        count++;
        return Response.json({ success: true });
      }
    );
    assert.equal(count, 0);
    assert.equal(db.writes.at(-1).update.state, 'cancelled');
  }
});

test('reconciliation persists an opt-out and never overwrites a receiving-agent confirmation',async()=>{
 const record={...call,lead_id:'lead1'};const writes=[];
 const db={from(table){let operation='read',value,filters=[];const q={select(){return q;},not(){return q;},or(){return q;},order(){return q;},limit(){return q;},eq(k,v){filters.push([k,v]);return q;},update(v){operation='update';value=v;return q;},upsert(v){operation='upsert';value=v;return q;},then(resolve){if(operation!=='read')writes.push({table,operation,value,filters});return Promise.resolve({data:operation==='read'?[record]:null,error:null}).then(resolve);}};return q;}};
 const response={agent_id:record.provider_agent_id,conversation_id:record.conversation_id,status:'done',conversation_initiation_client_data:{dynamic_variables:{plw_dental_call_id:record.id}},transcript:[{role:'agent',message:'Gracias',tool_calls:[{tool_name:'transfer_to_number'}]}],analysis:{data_collection_results:{plw_opt_out:{value:true}}}};
 await syncCalls(db,'test-key',async()=>Response.json(response));
 assert.ok(writes.some(w=>w.table==='ai_outbound_do_not_call'&&w.value.phone===record.phone));
 const transfer=writes.find(w=>w.value.transfer_status==='requested');assert.ok(transfer.filters.some(([k,v])=>k==='transfer_status'&&v==='none'));
 assert.ok(writes.some(w=>w.table==='dental_calls'&&w.value.transcript?.[0]?.message==='Gracias'));
});
