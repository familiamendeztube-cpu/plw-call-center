import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleWhatsApp } from '../../supabase/functions/whatsapp/handlers.js';

const CONFIG = { account: '194381', inbox: '151557', tokenKey: 'test-key-for-chatwoot-tokens-only-000' };
const NOW = 1793750500;
const AGENT_1 = { staffId: 'agent-1', role: 'agent' };
const AGENT_2 = { staffId: 'agent-2', role: 'agent' };
const ADMIN = { staffId: 'admin-1', role: 'admin' };
const CLIENT_OF_1 = '00000000-0000-0000-0000-000000000001';
const CLIENT_OF_2 = '00000000-0000-0000-0000-000000000002';

// What Chatwoot knows about each token's user.
const USERS = {
  tok_alejandro_0000000001: { id: 11, name: 'Alejandro Ruiz', role: 'agent', inboxes: [151557] },
  tok_jose_000000000000002: { id: 12, name: 'Jose Jimenez', role: 'agent', inboxes: [151557] },
  tok_jay_administrator_03: { id: 10, name: 'Jay', role: 'administrator', inboxes: [151557] },
  tok_no_whatsapp_inbox_04: { id: 14, name: 'Sin bandeja', role: 'agent', inboxes: [2] },
  tok_other_account_000005: { id: 15, name: 'Otra cuenta', role: 'agent', inboxes: [], account: 5 },
};
const ALEJANDRO = 'tok_alejandro_0000000001';
const JOSE = 'tok_jose_000000000000002';

const TEMPLATE = {
  name: 'plw_seguimiento_solicitud_web',
  language: 'es',
  category: 'MARKETING',
  status: 'APPROVED',
  components: [{ type: 'BODY', text: '¡Hola, {{1}}! … su negocio de {{2}} …' }],
};

const response = (status, body) => ({ status, ok: status < 300, json: async () => body });

function createChatwoot(revoked = new Set()) {
  const calls = [];
  const chatwoot = async (path, token, init = {}) => {
    const body =
      init.body instanceof FormData ? init.body : init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, token, method: init.method ?? 'GET', body });
    const user = USERS[token];
    if (!user || revoked.has(token)) return response(401, {});
    if (path === '/api/v1/profile') {
      return response(200, {
        id: user.id,
        name: user.name,
        email: `${user.id}@plw.test`,
        access_token: token,
        accounts: [{ id: user.account ?? 194381, role: user.role }],
      });
    }
    if (path === '/api/v1/accounts/194381/inboxes') {
      return response(200, { payload: user.inboxes.map((id) => ({ id })) });
    }
    if (path.includes('/message_templates')) return response(200, { payload: [TEMPLATE] });
    if (path.endsWith('/messages') && init.method === 'POST') {
      const content = body instanceof FormData ? (body.get('content') ?? '') : body.content;
      const file = body instanceof FormData ? body.get('attachments[]') : null;
      return response(200, {
        id: 99,
        content,
        message_type: 1,
        created_at: NOW,
        attachments: file ? [{ file_type: 'image', data_url: 'https://chat.example/foto.jpg' }] : [],
      });
    }
    if (path.endsWith('/messages')) {
      return response(200, { payload: [{ id: 1, content: 'Hola', message_type: 0, created_at: NOW }] });
    }
    return response(200, { id: 31, can_reply: true });
  };
  chatwoot.calls = calls;
  return chatwoot;
}

function createAdmin() {
  const rows = new Map();
  const table = {
    select: () => ({
      order: async () => ({ data: [...rows.values()], error: null }),
      eq: (_column, staffId) => ({
        maybeSingle: async () => ({ data: rows.get(staffId) ?? null, error: null }),
      }),
    }),
    delete: () => ({
      eq: async (_column, staffId) => {
        rows.delete(staffId);
        return { error: null };
      },
    }),
    async upsert(row) {
      const taken = [...rows.values()].some(
        (other) => other.chatwoot_user_id === row.chatwoot_user_id && other.staff_id !== row.staff_id
      );
      if (taken) return { error: { code: '23505' } };
      rows.set(row.staff_id, row);
      return { error: null };
    },
  };
  return {
    rows,
    from(name) {
      assert.equal(name, 'chatwoot_agent_accounts');
      return table;
    },
  };
}

// Row-level security as the database applies it: an agent sees only their own customers' chats.
const CHATS = {
  [CLIENT_OF_1]: { owner: 'agent-1', chatwoot_conversation_id: 31, ambiguous_match: false },
  [CLIENT_OF_2]: { owner: 'agent-2', chatwoot_conversation_id: 32, ambiguous_match: true },
};
function dbFor(staff) {
  return {
    from: () => ({
      select: () => ({
        eq: (_column, prospectId) => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => {
                const chat = CHATS[prospectId];
                const visible = chat && (staff.role === 'admin' || chat.owner === staff.staffId);
                return { data: visible ? chat : null, error: null };
              },
            }),
          }),
        }),
      }),
    }),
    rpc: async () => ({ error: null }),
  };
}

function setup() {
  const admin = createAdmin();
  const chatwoot = createChatwoot();
  const act = (staff, body) =>
    handleWhatsApp({ staff, body, admin, db: dbFor(staff), chatwoot, config: CONFIG });
  return { admin, chatwoot, act };
}

test('connecting stores who Chatwoot says the token belongs to, and only the ciphertext', async () => {
  const { admin, act } = setup();
  const result = await act(AGENT_1, { action: 'connect', token: ALEJANDRO });
  assert.deepEqual(result, { status: 200, body: { connected: true, sender: 'Alejandro Ruiz' } });
  const row = admin.rows.get('agent-1');
  assert.equal(row.chatwoot_user_id, 11);
  assert.equal(row.chatwoot_email, '11@plw.test');
  assert.ok(!JSON.stringify(row).includes(ALEJANDRO));
});

test('refuses an administrator token, another account, no WhatsApp inbox, or a bad token', async () => {
  for (const [token, message] of [
    ['tok_jay_administrator_03', /usuario de agente/],
    ['tok_other_account_000005', /no pertenece/],
    ['tok_no_whatsapp_inbox_04', /bandeja de WhatsApp/],
    ['tok_unknown_000000000000', /no es válido/],
    ['short', /no es válido/],
  ]) {
    const { admin, act } = setup();
    const result = await act(AGENT_1, { action: 'connect', token });
    assert.equal(result.status, 400, token);
    assert.match(result.body.error, message);
    assert.equal(admin.rows.size, 0);
  }
});

test('one Chatwoot user cannot answer for two PLW agents', async () => {
  const { act } = setup();
  await act(AGENT_1, { action: 'connect', token: ALEJANDRO });
  const result = await act(AGENT_2, { action: 'connect', token: ALEJANDRO });
  assert.equal(result.status, 409);
});

test('each agent replies with their own Chatwoot user, whatever the browser sends', async () => {
  const { chatwoot, act } = setup();
  await act(AGENT_1, { action: 'connect', token: ALEJANDRO });
  await act(AGENT_2, { action: 'connect', token: JOSE });

  // A tampered request naming the other agent changes nothing.
  const one = await act(AGENT_1, {
    action: 'send',
    prospectId: CLIENT_OF_1,
    text: 'Hola',
    staffId: 'agent-2',
    token: JOSE,
  });
  const two = await act(AGENT_2, { action: 'send', prospectId: CLIENT_OF_2, text: 'Buenas' });
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  const posts = chatwoot.calls.filter((call) => call.method === 'POST');
  assert.deepEqual(
    posts.map(({ path, token }) => [path, token]),
    [
      ['/api/v1/accounts/194381/conversations/31/messages', ALEJANDRO],
      ['/api/v1/accounts/194381/conversations/32/messages', JOSE],
    ]
  );
});

test("an agent cannot open or answer another agent's customer", async () => {
  const { chatwoot, act } = setup();
  await act(AGENT_1, { action: 'connect', token: ALEJANDRO });
  const before = chatwoot.calls.length;
  for (const action of ['load', 'send', 'templates']) {
    const result = await act(AGENT_1, { action, prospectId: CLIENT_OF_2, text: 'Hola' });
    assert.equal(result.status, 404, action);
  }
  assert.equal(chatwoot.calls.length, before);
});

test('an agent who has not connected is asked to, and nothing reaches Chatwoot', async () => {
  const { chatwoot, act } = setup();
  assert.deepEqual(await act(AGENT_1, { action: 'load', prospectId: CLIENT_OF_1 }), {
    status: 200,
    body: { connected: false },
  });
  const sent = await act(AGENT_1, { action: 'send', prospectId: CLIENT_OF_1, text: 'Hola' });
  assert.equal(sent.status, 409);
  assert.equal(chatwoot.calls.length, 0);
});

test('a token revoked in Chatwoot is forgotten and the agent connects again', async () => {
  const admin = createAdmin();
  const revoked = new Set();
  const chatwoot = createChatwoot(revoked);
  const act = (body) =>
    handleWhatsApp({ staff: AGENT_1, body, admin, db: dbFor(AGENT_1), chatwoot, config: CONFIG });
  await act({ action: 'connect', token: ALEJANDRO });
  revoked.add(ALEJANDRO);
  assert.deepEqual((await act({ action: 'load', prospectId: CLIENT_OF_1 })).body, {
    connected: false,
  });
  assert.equal(admin.rows.size, 0);
});

test('the chat shows who the agent replies as and flags a shared number', async () => {
  const { act } = setup();
  await act(AGENT_2, { action: 'connect', token: JOSE });
  const result = await act(AGENT_2, { action: 'load', prospectId: CLIENT_OF_2 });
  assert.equal(result.body.sender, 'Jose Jimenez');
  assert.equal(result.body.ambiguous, true);
  assert.equal(result.body.messages[0].author, 'customer');
});

test('agents disconnect only themselves; the administrator sees and manages every link', async () => {
  const { admin, act } = setup();
  await act(AGENT_1, { action: 'connect', token: ALEJANDRO });
  await act(AGENT_2, { action: 'connect', token: JOSE });

  await act(AGENT_1, { action: 'disconnect', staffId: 'agent-2' });
  assert.deepEqual([...admin.rows.keys()], ['agent-2']);

  assert.equal((await act(AGENT_2, { action: 'list_connections' })).status, 403);
  const listed = await act(ADMIN, { action: 'list_connections' });
  assert.deepEqual(listed.body.connections.map((row) => [row.staffId, row.name]), [
    ['agent-2', 'Jose Jimenez'],
  ]);
  assert.ok(!JSON.stringify(listed.body).includes('ciphertext'));

  await act(ADMIN, { action: 'disconnect', staffId: 'agent-2' });
  assert.equal(admin.rows.size, 0);
  // The administrator does not answer WhatsApp from PLW.
  assert.equal((await act(ADMIN, { action: 'connect', token: ALEJANDRO })).status, 403);
});

test("a template's wording and category come from Chatwoot; every blank must be filled", async () => {
  const { chatwoot, act } = setup();
  await act(AGENT_1, { action: 'connect', token: ALEJANDRO });
  const send = (template) => act(AGENT_1, { action: 'send_template', prospectId: CLIENT_OF_1, template });

  const ok = await send({
    name: TEMPLATE.name,
    language: 'es',
    values: { 1: 'Ana', 2: 'restaurante' },
    body: 'Texto inventado',
    category: 'UTILITY',
  });
  assert.equal(ok.status, 200);
  const post = chatwoot.calls.find((call) => call.method === 'POST');
  assert.equal(post.body.content, '¡Hola, Ana! … su negocio de restaurante …');
  assert.deepEqual(post.body.template_params, {
    name: 'plw_seguimiento_solicitud_web',
    category: 'MARKETING',
    language: 'es',
    processed_params: { body: { 1: 'Ana', 2: 'restaurante' } },
  });

  const missing = await send({ name: TEMPLATE.name, language: 'es', values: { 1: 'Ana' } });
  assert.equal(missing.status, 400);
  const wrongLanguage = await send({ name: TEMPLATE.name, language: 'es_MX', values: { 1: 'A', 2: 'B' } });
  assert.equal(wrongLanguage.status, 400);
  assert.equal(chatwoot.calls.filter((call) => call.method === 'POST').length, 1);
});

test("a photo goes to Chatwoot as the agent's own upload, with the text as its caption", async () => {
  const { chatwoot, act } = setup();
  await act(AGENT_1, { action: 'connect', token: ALEJANDRO });
  const photo = new File([new Uint8Array(2048)], 'Menú.JPG', { type: '' });

  const result = await act(AGENT_1, { action: 'send', prospectId: CLIENT_OF_1, text: ' Así quedaría ', file: photo });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.message.attachments, [
    { kind: 'image', url: 'https://chat.example/foto.jpg' },
  ]);
  const post = chatwoot.calls.find((call) => call.method === 'POST');
  assert.equal(post.token, ALEJANDRO);
  assert.equal(post.body.get('content'), 'Así quedaría');
  assert.equal(post.body.get('message_type'), 'outgoing');
  assert.equal(post.body.get('private'), 'false');
  const sent = post.body.get('attachments[]');
  assert.equal(sent.name, 'Menú.JPG');
  assert.equal(sent.type, 'image/jpeg');
  assert.equal(sent.size, 2048);
});

test('files WhatsApp would refuse never reach Chatwoot', async () => {
  const { chatwoot, act } = setup();
  await act(AGENT_1, { action: 'connect', token: ALEJANDRO });
  const before = chatwoot.calls.length;
  const send = (file, text = '') => act(AGENT_1, { action: 'send', prospectId: CLIENT_OF_1, text, file });

  assert.match((await send(new File(['x'], 'virus.exe'))).body.error, /no acepta/);
  assert.match((await send(new File([new Uint8Array(6 * 1024 * 1024)], 'grande.png'))).body.error, /5 MB/);
  assert.match((await send(new File(['x'], 'nota.pdf'), 'a'.repeat(1025))).body.error, /1024/);
  assert.equal((await send('not-a-file')).status, 400);
  assert.equal(chatwoot.calls.length, before);
});
