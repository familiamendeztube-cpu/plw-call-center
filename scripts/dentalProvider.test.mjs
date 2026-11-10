import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentConfigFailures,
  callResults,
  dentalAgentConfig,
  safeAgent,
  conversationUpdate,
} from '../supabase/functions/dental-dialer/provider.js';
import {
  DENTAL_FIRST_MESSAGE,
  SALES_SCRIPT_VERSION,
  greetingFor,
} from '../supabase/functions/dental-dialer/salesScript.js';
import {
  dispatchCall,
  reconcileStuckCalls,
  syncCalls,
} from '../supabase/functions/dental-dialer/runner.js';
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
test('verifier names each failed invariant and accepts only line-ending and edge-whitespace normalization', () => {
  const base = { agent_id: route.provider_agent_id, ...dentalAgentConfig('Valeska', route, 'voice') };
  const crlf = structuredClone(base);
  crlf.conversation_config.agent.prompt.prompt = crlf.conversation_config.agent.prompt.prompt.replace(/\n/g, '\r\n') + '\n';
  assert.deepEqual(agentConfigFailures(crlf, route), []);
  const withSystemTools = structuredClone(base);
  withSystemTools.conversation_config.agent.prompt.tools = [
    { name: 'end_call', type: 'system' },
    { name: 'transfer_to_number', type: 'system' },
  ];
  assert.deepEqual(agentConfigFailures(withSystemTools, route), []);
  const cases = [
    ['extra_tools_or_knowledge', (c) => (c.conversation_config.agent.prompt.tools = [{ name: 'lookup', type: 'webhook' }])],
    ['first_message', (c) => (c.conversation_config.agent.first_message = 'Hola')],
    ['voice_model', (c) => (c.conversation_config.tts.model_id = 'eleven_turbo_v2')],
    ['script_version', (c) => (c.conversation_config.agent.prompt.prompt = c.conversation_config.agent.prompt.prompt.replace(SALES_SCRIPT_VERSION, 'old'))],
    ['extra_builtin_tool', (c) => (c.conversation_config.agent.prompt.built_in_tools.skip_turn = { type: 'system' })],
    ['transfer_count', (c) => (c.conversation_config.agent.prompt.built_in_tools.transfer_to_number.params.transfers = [])],
    ['workflow', (c) => (c.workflow = { nodes: { a: {} } })],
  ];
  for (const [code, mutate] of cases) {
    const other = structuredClone(base);
    mutate(other);
    assert.ok(agentConfigFailures(other, route).includes(code), code);
  }
  assert.deepEqual(agentConfigFailures({ ...base, agent_id: PLW_AGENT_ID }, { ...route, provider_agent_id: PLW_AGENT_ID }), ['agent_identity']);
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
  // The first message needs {{saludo}}; ElevenLabs rejects a call missing a variable it uses.
  assert.ok(DENTAL_FIRST_MESSAGE.includes('{{saludo}}'));
  assert.match(payload.conversation_initiation_client_data.dynamic_variables.saludo, /^Muy buen/);
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
 const db={from(table){let operation='read',value,filters=[];const q={select(){return q;},not(){return q;},or(){return q;},order(){return q;},limit(){return q;},eq(k,v){filters.push([k,v]);return q;},neq(k,v){filters.push(['not '+k,v]);return q;},update(v){operation='update';value=v;return q;},upsert(v){operation='upsert';value=v;return q;},then(resolve){if(operation!=='read')writes.push({table,operation,value,filters});return Promise.resolve({data:operation==='read'?[record]:null,error:null}).then(resolve);}};return q;}};
 const response={agent_id:record.provider_agent_id,conversation_id:record.conversation_id,status:'done',conversation_initiation_client_data:{dynamic_variables:{plw_dental_call_id:record.id}},transcript:[{role:'agent',message:'Gracias',tool_calls:[{tool_name:'transfer_to_number'}]}],analysis:{data_collection_results:{plw_opt_out:{value:true}}}};
 await syncCalls(db,'test-key',async()=>Response.json(response));
 assert.ok(writes.some(w=>w.table==='ai_outbound_do_not_call'&&w.value.phone===record.phone));
 const transfer=writes.find(w=>w.value.transfer_status==='requested');assert.ok(transfer.filters.some(([k,v])=>k==='transfer_status'&&v==='none'));
 assert.ok(writes.some(w=>w.table==='dental_calls'&&w.value.transcript?.[0]?.message==='Gracias'));
 const lead=writes.find(w=>w.table==='dental_leads');
 assert.equal(lead.value.status,'do_not_call');
 assert.ok(lead.filters.some(([k,v])=>k==='not status'&&v==='do_not_call'));
});

test('a provider refusal is stored with its reason so the history explains it', async () => {
  const db = fakeDb();
  await dispatchCall(db, 'test-key', { call, route, lead: {} }, async () =>
    Response.json({ success: false, message: 'dial failed with 404 User Not Found' })
  );
  assert.equal(db.writes.at(-1).update.state, 'failed');
  assert.match(db.writes.at(-1).update.error, /HTTP 200: dial failed with 404 User Not Found/);
});

// Chainable stand-in for the Supabase client: reads return `rows`, writes are recorded.
function chainDb(rows) {
  const writes = [];
  return {
    writes,
    from(table) {
      let value;
      const filters = [];
      const q = new Proxy({}, {
        get(_, name) {
          if (name === 'then')
            return (resolve) => {
              if (value) writes.push({ table, value, filters });
              return Promise.resolve({ data: value ? null : rows, error: null }).then(resolve);
            };
          return (...args) => {
            if (name === 'update') value = args[0];
            else filters.push([name, ...args]);
            return q;
          };
        },
      });
      return q;
    },
  };
}
test('stuck calls are recovered from ElevenLabs, or closed only after a clean 15-minute search', async () => {
  const now = Date.parse('2026-11-10T18:30:00Z');
  const stuck = (minutesAgo) => ({
    id: 'call-1',
    state: 'uncertain',
    provider_agent_id: route.provider_agent_id,
    created_at: new Date(now - minutesAgo * 60_000).toISOString(),
  });
  const provider = (conversations, details = {}) => async (url) =>
    url.includes('/conversations?')
      ? Response.json({ conversations })
      : Response.json(details[url.split('/conversations/')[1]] ?? {});
  const started = Math.floor((now - 20 * 60_000) / 1000) + 5;
  // Found: the conversation carrying this call id becomes the call's conversation.
  let db = chainDb([stuck(20)]);
  await reconcileStuckCalls(db, 'k', provider(
    [{ conversation_id: 'other', start_time_unix_secs: started }, { conversation_id: 'conv9', start_time_unix_secs: started }],
    {
      other: { agent_id: route.provider_agent_id, conversation_initiation_client_data: { dynamic_variables: { plw_dental_call_id: 'call-2' } } },
      conv9: { agent_id: route.provider_agent_id, conversation_initiation_client_data: { dynamic_variables: { plw_dental_call_id: 'call-1' } } },
    }
  ), now);
  assert.equal(db.writes[0].value.state, 'started');
  assert.equal(db.writes[0].value.conversation_id, 'conv9');
  assert.ok(db.writes[0].filters.some(([m, k, v]) => m === 'eq' && k === 'state' && v === 'uncertain'));
  // Old, searched, nothing found: closed as failed so the slot is freed.
  db = chainDb([stuck(20)]);
  await reconcileStuckCalls(db, 'k', provider([]), now);
  assert.equal(db.writes[0].value.state, 'failed');
  // Recent, or the provider could not be searched: only the check time is recorded.
  db = chainDb([stuck(5)]);
  await reconcileStuckCalls(db, 'k', provider([]), now);
  assert.equal(db.writes[0].value.state, undefined);
  db = chainDb([stuck(20)]);
  await reconcileStuckCalls(db, 'k', async () => new Response('down', { status: 500 }), now);
  assert.equal(db.writes[0].value.state, undefined);
  assert.ok(db.writes[0].value.synced_at);
});

test('Anna greets by Costa Rica time of day', () => {
  assert.equal(greetingFor(new Date('2026-11-10T15:00:00Z')), 'Muy buenos días'); // 09:00 CR
  assert.equal(greetingFor(new Date('2026-11-10T21:30:00Z')), 'Muy buenas tardes'); // 15:30 CR
  assert.equal(greetingFor(new Date('2026-11-11T01:00:00Z')), 'Muy buenas noches'); // 19:00 CR
});

test('call results keep only known outcomes and spoken details, and map them to lead status', () => {
  const r = (results) => callResults({ data_collection_results: results });
  const booked = r({
    plw_outcome: { value: ' appointment_requested ' },
    plw_contact_name: { value: '  Dra.   Mora ' },
    plw_appointment_date: { value: 'jueves' },
    plw_notes: { value: 'null' },
    plw_pain_point: { value: null },
  });
  assert.equal(booked.outcome, 'APPOINTMENT_REQUESTED');
  assert.deepEqual(booked.details, { contact_name: 'Dra. Mora', appointment_date: 'jueves' });
  assert.equal(booked.leadStatus, 'interested');
  assert.equal(booked.optOut, false);
  // Unknown codes are dropped; a string "true" opt-out still counts and wins over everything.
  const optOut = r({ plw_outcome: { value: 'BOOKED' }, plw_opt_out: { value: 'true' } });
  assert.equal(optOut.outcome, null);
  assert.equal(optOut.optOut, true);
  assert.equal(optOut.leadStatus, 'do_not_call');
  assert.equal(r({ plw_outcome: { value: 'DO_NOT_CALL' } }).optOut, true);
  // No answer leaves the lead pending; old boolean fields still work without an outcome.
  assert.equal(r({ plw_outcome: { value: 'NO_ANSWER' } }).leadStatus, null);
  assert.equal(r({ plw_callback: { value: true } }).leadStatus, 'callback');
  // The list form is read the same way.
  const list = callResults({
    data_collection_results_list: [{ data_collection_id: 'plw_outcome', value: 'WRONG_NUMBER' }],
  });
  assert.equal(list.leadStatus, 'wrong_number');
  assert.deepEqual(callResults(null), { outcome: null, details: {}, optOut: false, leadStatus: null });
});
