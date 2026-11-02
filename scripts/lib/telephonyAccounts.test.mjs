import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  authorizeStaff,
  handleTelephonyAction,
} from '../../supabase/functions/telephony/handlers.js';

const KEY = 'test-encryption-key';
const PASSWORD = '0123456789abcdef0123456789abcdef';
const AGENT = { staffId: 'agent-1', role: 'agent' };
const OTHER_AGENT = { staffId: 'agent-2', role: 'agent' };
const ADMIN = { staffId: 'admin-1', role: 'admin' };
const VALID_ACCOUNT = {
  action: 'set_account',
  staffId: 'agent-1',
  wssUrl: 'wss://phone.example.com:8089/ws',
  sipDomain: 'phone.example.com',
  username: 'agent-1',
  password: PASSWORD,
};

function createAdminClient() {
  const rows = new Map();

  return {
    rows,
    from() {
      return {
        select() {
          return {
            then: (resolve) => resolve({ data: [...rows.values()], error: null }),
            eq: (_column, staffId) => ({
              maybeSingle: async () => ({ data: rows.get(staffId) ?? null, error: null }),
            }),
          };
        },
      };
    },
    async rpc(name, args) {
      assert.equal(name, 'set_agent_sip_account');
      const taken = [...rows.values()].some(
        (row) => row.sip_username === args.p_sip_username && row.staff_id !== args.p_staff_id
      );
      if (taken) return { error: { code: '23505', message: 'duplicate key' } };
      rows.set(args.p_staff_id, {
        staff_id: args.p_staff_id,
        wss_url: args.p_wss_url,
        sip_domain: args.p_sip_domain,
        sip_username: args.p_sip_username,
        password_ciphertext: args.p_password_ciphertext,
        updated_at: '2026-11-02T12:00:00Z',
      });
      return { error: null };
    },
  };
}

function act(admin, staff, body, encryptionKey = KEY) {
  return handleTelephonyAction({ admin, staff, body, encryptionKey });
}

test('a saved password is stored only as ciphertext', async () => {
  const admin = createAdminClient();

  const result = await act(admin, ADMIN, VALID_ACCOUNT);

  assert.equal(result.status, 200);
  assert.ok(!JSON.stringify([...admin.rows.values()]).includes(PASSWORD));
});

test('an agent receives their own login with the password', async () => {
  const admin = createAdminClient();
  await act(admin, ADMIN, VALID_ACCOUNT);

  const result = await act(admin, AGENT, { action: 'get_my_account' });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.account, {
    wssUrl: VALID_ACCOUNT.wssUrl,
    sipDomain: VALID_ACCOUNT.sipDomain,
    username: 'agent-1',
    password: PASSWORD,
  });
});

test('an agent cannot receive another agent login by naming it in the request', async () => {
  const admin = createAdminClient();
  await act(admin, ADMIN, VALID_ACCOUNT);

  const result = await act(admin, OTHER_AGENT, { action: 'get_my_account', staffId: 'agent-1' });

  assert.deepEqual(result.body, { account: null });
});

test('administrators can never read a password back', async () => {
  const admin = createAdminClient();
  await act(admin, ADMIN, VALID_ACCOUNT);

  const listed = await act(admin, ADMIN, { action: 'list_accounts' });
  const asAgent = await act(admin, ADMIN, { action: 'get_my_account' });

  assert.equal(listed.status, 200);
  assert.deepEqual(Object.keys(listed.body.accounts[0]).sort(), [
    'sipDomain',
    'staffId',
    'updatedAt',
    'username',
    'wssUrl',
  ]);
  assert.equal(asAgent.status, 403);
});

test('agents cannot list or change logins', async () => {
  const admin = createAdminClient();

  assert.equal((await act(admin, AGENT, { action: 'list_accounts' })).status, 403);
  assert.equal((await act(admin, AGENT, VALID_ACCOUNT)).status, 403);
  assert.equal(admin.rows.size, 0);
});

test('bad login details are refused before anything is saved', async () => {
  const admin = createAdminClient();
  const badValues = [
    { wssUrl: 'ws://phone.example.com:8089/ws' },
    { wssUrl: 'wss://user:secret@phone.example.com/ws' },
    { sipDomain: 'not a domain' },
    { username: 'vocex' },
    { staffId: 'admin-1' },
    { password: 'short' },
    { password: 'contains;semicolon0123456789' },
    { password: 'contains space 0123456789' },
  ];

  for (const bad of badValues) {
    const result = await act(admin, ADMIN, { ...VALID_ACCOUNT, ...bad });
    assert.equal(result.status, 400, JSON.stringify(bad));
  }
  assert.equal(admin.rows.size, 0);
});

test('one SIP username cannot be given to two agents', async () => {
  const admin = createAdminClient();
  await act(admin, ADMIN, VALID_ACCOUNT);

  const result = await act(admin, ADMIN, { ...VALID_ACCOUNT, staffId: 'agent-2' });

  assert.equal(result.status, 409);
});

test('without the server key nothing is saved or returned', async () => {
  const admin = createAdminClient();
  await act(admin, ADMIN, VALID_ACCOUNT);

  assert.equal((await act(admin, ADMIN, VALID_ACCOUNT, '')).status, 503);
  assert.equal((await act(admin, AGENT, { action: 'get_my_account' }, '')).status, 503);
});

test('a revoked or invalid session is not authorized', async () => {
  const claims = Buffer.from(JSON.stringify({ session_id: 'session-1' })).toString('base64url');
  const jwt = `header.${claims}.signature`;
  const auth = { getUser: async () => ({ data: { user: { id: 'auth-1' } }, error: null }) };

  const revoked = await authorizeStaff({
    admin: { auth, rpc: async () => ({ data: [], error: null }) },
    jwt,
  });
  const live = await authorizeStaff({
    admin: {
      auth,
      rpc: async () => ({ data: [{ staff_id: 'agent-1', staff_role: 'agent' }], error: null }),
    },
    jwt,
  });
  const invalid = await authorizeStaff({
    admin: { auth: { getUser: async () => ({ data: null, error: new Error('bad jwt') }) } },
    jwt,
  });

  assert.equal(revoked, null);
  assert.equal(invalid, null);
  assert.deepEqual(live, { staffId: 'agent-1', role: 'agent' });
});

test('browser roles have no access to the login table or its save function', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20261102130000_agent_sip_accounts.sql', import.meta.url),
    'utf8'
  );

  assert.match(migration, /REVOKE ALL ON public\.agent_sip_accounts FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /ALTER TABLE public\.agent_sip_accounts ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.set_agent_sip_account[^;]*FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /CREATE POLICY/);
  assert.doesNotMatch(migration, /GRANT[^;]*TO (anon|authenticated)/);
});
