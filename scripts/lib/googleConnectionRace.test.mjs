import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_MAILBOX,
  GMAIL_READ_SCOPE,
  GMAIL_SEND_SCOPE,
} from '../../supabase/functions/google-workspace/rules.js';
import {
  completeAuthorization,
  handleDisconnect,
  handleStart,
  handleVerify,
} from '../../supabase/functions/google-workspace/handlers.js';
import { decryptRefreshToken } from '../../supabase/functions/google-workspace/tokenCrypto.js';

const CALLBACK_URL = 'https://example.supabase.co/functions/v1/google-workspace/oauth/callback';
const KEY = 'test-token-key-with-at-least-32-characters';
const ENV = {
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  PLW_GOOGLE_TOKEN_KEY: KEY,
  PLW_APP_ORIGIN: 'https://app.example.test',
};
const BOTH_SCOPES = `${GMAIL_READ_SCOPE} ${GMAIL_SEND_SCOPE}`;
const ADMIN = { id: 'agent-900010', authUserId: 'auth-admin', sessionId: 'session-admin' };

const tick = () => new Promise((resolve) => setImmediate(resolve));

function createFakeStore() {
  const store = {
    connection: {
      status: 'disconnected',
      connected_account: null,
      refresh_token_ciphertext: null,
      connected_at: null,
      last_verified_at: null,
      last_error: null,
      scopes: [],
      connection_version: 0,
    },
    states: [],
    staff: new Map([[ADMIN.id, { authUserId: ADMIN.authUserId, role: 'admin', enabled: true }]]),
    sessions: new Map([[ADMIN.sessionId, { authUserId: ADMIN.authUserId, staffId: ADMIN.id }]]),
  };

  const liveRows = (sessionId, authUserId) => {
    const session = store.sessions.get(sessionId);
    if (!session || session.authUserId !== authUserId) return [];
    const staff = store.staff.get(session.staffId);
    if (!staff || !staff.enabled || staff.authUserId !== authUserId) return [];
    return [{ staff_id: session.staffId, staff_role: staff.role }];
  };
  const isLiveAdmin = (sessionId, authUserId, staffId) =>
    liveRows(sessionId, authUserId).some((row) => row.staff_id === staffId && row.staff_role === 'admin');

  return {
    ...store,
    async getConnection() {
      return { ...store.connection, scopes: [...store.connection.scopes] };
    },
    async createState(state) {
      store.states.push({
        id: `state-${store.states.length + 1}`,
        staff_id: state.staffId,
        auth_user_id: state.authUserId,
        session_id: state.sessionId,
        connection_version: state.connectionVersion,
        created_at: new Date().toISOString(),
        expires_at: state.expiresAt,
        used_at: null,
        state_hash: state.stateHash,
      });
    },
    async findState(stateHash) {
      const row = store.states.find((state) => state.state_hash === stateHash);
      return row ? { ...row } : null;
    },
    async claimState(id) {
      const row = store.states.find((state) => state.id === id);
      if (!row || row.used_at || row.expires_at <= new Date().toISOString()) return false;
      row.used_at = new Date().toISOString();
      return true;
    },
    async resolveSession(sessionId, authUserId) {
      return liveRows(sessionId, authUserId);
    },
    async saveConnection(guard, patch, requireStatus) {
      if (store.connection.connection_version !== guard.expectedVersion) return 'superseded';
      if (requireStatus && store.connection.status !== requireStatus) return 'superseded';
      if (!isLiveAdmin(guard.sessionId, guard.authUserId, guard.staffId)) return 'session-ended';
      Object.assign(store.connection, patch);
      return 'saved';
    },
    async disconnect(actor) {
      if (!isLiveAdmin(actor.sessionId, actor.authUserId, actor.id)) return null;
      const previousCiphertext = store.connection.refresh_token_ciphertext;
      Object.assign(store.connection, {
        status: 'disconnected',
        refresh_token_ciphertext: null,
        connected_account: null,
        connected_at: null,
        last_verified_at: null,
        scopes: [],
        last_error: null,
        connection_version: store.connection.connection_version + 1,
      });
      store.states.forEach((state) => {
        if (!state.used_at) state.used_at = new Date().toISOString();
      });
      return { newVersion: store.connection.connection_version, previousCiphertext };
    },
  };
}

function createGoogleFake() {
  const queues = { exchange: [], refresh: [], profile: [] };
  const revoked = [];

  const classify = (url, body) => {
    if (url.includes('/revoke')) return 'revoke';
    if (url.includes('gmail.googleapis.com')) return 'profile';
    if (String(body).includes('grant_type=refresh_token')) return 'refresh';
    return 'exchange';
  };

  const fetchImpl = async (url, init = {}) => {
    const kind = classify(String(url), init.body);
    if (kind === 'revoke') {
      revoked.push(new URLSearchParams(init.body).get('token'));
      return jsonResponse(200, {});
    }
    const pending = { release: null, promise: null };
    pending.promise = new Promise((resolve) => {
      pending.release = resolve;
    });
    queues[kind].push(pending);
    return pending.promise;
  };

  return {
    fetchImpl,
    revoked,
    async waitForCall(kind) {
      while (queues[kind].length === 0) await tick();
    },
    answer(kind, response) {
      const pending = queues[kind].shift();
      assert.ok(pending, `no pending ${kind} call`);
      pending.release(response);
    },
  };
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup() {
  const db = createFakeStore();
  const google = createGoogleFake();
  const deps = { db, env: ENV, fetchImpl: google.fetchImpl, callbackUrl: CALLBACK_URL };
  return { db, google, deps };
}

async function beginAuthorization(deps, actor = ADMIN) {
  const started = await handleStart(deps, actor);
  assert.equal(started.status, 200);
  const state = new URL(started.body.authorizationUrl).searchParams.get('state');
  return new URL(`${CALLBACK_URL}?code=auth-code&state=${state}`);
}

async function finishGoogleExchange(google, refreshToken, scope = BOTH_SCOPES) {
  await google.waitForCall('exchange');
  google.answer('exchange', jsonResponse(200, { access_token: 'access-1', refresh_token: refreshToken, scope }));
  await google.waitForCall('profile');
  google.answer('profile', jsonResponse(200, { emailAddress: BUSINESS_MAILBOX }));
}

async function connectFresh(deps, google, refreshToken = 'refresh-fresh') {
  const url = await beginAuthorization(deps);
  const outcome = completeAuthorization(deps, url);
  await finishGoogleExchange(google, refreshToken);
  return outcome;
}

test('disconnect during authorization leaves the mailbox disconnected when the late callback finishes', async () => {
  const { db, google, deps } = setup();
  const url = await beginAuthorization(deps);
  const callback = completeAuthorization(deps, url);

  await google.waitForCall('exchange');
  const disconnected = await handleDisconnect(deps, ADMIN);
  assert.equal(disconnected.status, 200);
  assert.equal(db.connection.connection_version, 1);

  google.answer('exchange', jsonResponse(200, { access_token: 'a', refresh_token: 'late-refresh', scope: BOTH_SCOPES }));
  await google.waitForCall('profile');
  google.answer('profile', jsonResponse(200, { emailAddress: BUSINESS_MAILBOX }));

  assert.equal(await callback, 'superseded');
  assert.equal(db.connection.status, 'disconnected');
  assert.equal(db.connection.refresh_token_ciphertext, null);
  assert.deepEqual(google.revoked.filter((token) => token === 'late-refresh'), ['late-refresh']);
});

test('a fresh authorization after disconnect succeeds', async () => {
  const { db, google, deps } = setup();
  const url = await beginAuthorization(deps);
  const stale = completeAuthorization(deps, url);
  await google.waitForCall('exchange');
  await handleDisconnect(deps, ADMIN);
  google.answer('exchange', jsonResponse(200, { access_token: 'a', refresh_token: 'late', scope: BOTH_SCOPES }));
  await google.waitForCall('profile');
  google.answer('profile', jsonResponse(200, { emailAddress: BUSINESS_MAILBOX }));
  assert.equal(await stale, 'superseded');

  const outcome = await connectFresh(deps, google, 'refresh-after-disconnect');
  assert.equal(outcome, 'connected');
  assert.equal(db.connection.status, 'connected');
  assert.equal(db.connection.connection_version, 1);
  assert.equal(await decryptRefreshToken(db.connection.refresh_token_ciphertext, KEY), 'refresh-after-disconnect');
  assert.deepEqual(db.connection.scopes, [GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE]);
});

test('disconnect during verification blocks a delayed success from reconnecting the mailbox', async () => {
  const { db, google, deps } = setup();
  assert.equal(await connectFresh(deps, google, 'refresh-verify'), 'connected');

  const verifying = handleVerify(deps, ADMIN);
  await google.waitForCall('refresh');
  const disconnected = await handleDisconnect(deps, ADMIN);
  assert.equal(disconnected.status, 200);

  google.answer('refresh', jsonResponse(200, { access_token: 'access-2', scope: BOTH_SCOPES }));
  await google.waitForCall('profile');
  google.answer('profile', jsonResponse(200, { emailAddress: BUSINESS_MAILBOX }));

  const result = await verifying;
  assert.equal(result.body.verified, false);
  assert.match(result.body.message, /cambió mientras Google respondía/);
  assert.equal(db.connection.status, 'disconnected');
  assert.equal(db.connection.refresh_token_ciphertext, null);
  assert.equal(db.connection.last_verified_at, null);
});

test('a delayed verification error does not overwrite a disconnected mailbox', async () => {
  const { db, google, deps } = setup();
  assert.equal(await connectFresh(deps, google, 'refresh-error'), 'connected');

  const verifying = handleVerify(deps, ADMIN);
  await google.waitForCall('refresh');
  await handleDisconnect(deps, ADMIN);
  google.answer('refresh', jsonResponse(400, { error: 'invalid_grant' }));

  const result = await verifying;
  assert.equal(result.body.verified, false);
  assert.equal(db.connection.status, 'disconnected');
  assert.equal(db.connection.last_error, null);
});

test('a verification started before a reconnect cannot mark the new connection as an error', async () => {
  const { db, google, deps } = setup();
  assert.equal(await connectFresh(deps, google, 'refresh-old'), 'connected');

  const oldVerify = handleVerify(deps, ADMIN);
  await google.waitForCall('refresh');
  await handleDisconnect(deps, ADMIN);
  assert.equal(await connectFresh(deps, google, 'refresh-new'), 'connected');

  google.answer('refresh', jsonResponse(400, { error: 'invalid_grant' }));
  await oldVerify;
  assert.equal(db.connection.status, 'connected');
  assert.equal(db.connection.connection_version, 1);
  assert.equal(await decryptRefreshToken(db.connection.refresh_token_ciphertext, KEY), 'refresh-new');
});

test('logging out during the code exchange stops the callback from connecting', async () => {
  const { db, google, deps } = setup();
  const url = await beginAuthorization(deps);
  const callback = completeAuthorization(deps, url);
  await google.waitForCall('exchange');

  db.sessions.delete(ADMIN.sessionId);
  google.answer('exchange', jsonResponse(200, { access_token: 'a', refresh_token: 'late', scope: BOTH_SCOPES }));
  await google.waitForCall('profile');
  google.answer('profile', jsonResponse(200, { emailAddress: BUSINESS_MAILBOX }));

  assert.equal(await callback, 'access-denied');
  assert.equal(db.connection.status, 'disconnected');
  assert.ok(google.revoked.includes('late'));
});

test('a reused or expired state is rejected without contacting Google', async () => {
  const { db, google, deps } = setup();
  const url = await beginAuthorization(deps);
  const first = completeAuthorization(deps, url);
  await finishGoogleExchange(google, 'refresh-once');
  assert.equal(await first, 'connected');

  assert.equal(await completeAuthorization(deps, url), 'state-invalid');

  const expiredUrl = await beginAuthorization(deps);
  db.states.at(-1).expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal(await completeAuthorization(deps, expiredUrl), 'state-invalid');
  assert.equal(db.connection.connection_version, 0);
});

test('partial consent reports missing permissions and keeps only the granted scope', async () => {
  const { db, google, deps } = setup();
  const url = await beginAuthorization(deps);
  const callback = completeAuthorization(deps, url);
  await finishGoogleExchange(google, 'refresh-partial', GMAIL_READ_SCOPE);

  assert.equal(await callback, 'permissions-missing');
  assert.equal(db.connection.status, 'error');
  assert.equal(db.connection.refresh_token_ciphertext, null);
  assert.deepEqual(db.connection.scopes, [GMAIL_READ_SCOPE]);
  assert.ok(google.revoked.includes('refresh-partial'));
});
