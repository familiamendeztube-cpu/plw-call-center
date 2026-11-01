import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_MAILBOX,
  describeMissingPermissions,
  describeRefreshFailure,
  evaluateAdminSession,
  evaluateGrantedScopes,
  evaluateStateRow,
  evaluateStateSession,
  GMAIL_READ_SCOPE,
  GMAIL_SEND_SCOPE,
  mailboxMatches,
  mailboxMismatchMessage,
  missingSecrets,
  sessionIdFromJwt,
} from '../../supabase/functions/google-workspace/rules.js';
import {
  GoogleApiError,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  fetchMailboxAddress,
  refreshAccessToken,
  revokeToken,
} from '../../supabase/functions/google-workspace/googleApi.js';
import {
  decryptRefreshToken,
  encryptRefreshToken,
} from '../../supabase/functions/google-workspace/tokenCrypto.js';

const NOW = Date.parse('2026-06-01T12:00:00Z');
const KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const SESSION = '5b1c2d3e-0000-4000-8000-000000000001';
const AUTH_USER = '9a8b7c6d-0000-4000-8000-000000000002';
const STAFF = 'agent-100001';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeJwt(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}

function liveRow(overrides = {}) {
  return [{ staff_id: STAFF, staff_role: 'admin', ...overrides }];
}

test('admin session accepts a live administrator session only', () => {
  assert.deepEqual(
    evaluateAdminSession({ sessionId: SESSION, resolved: liveRow() }),
    { ok: true, staffId: STAFF },
  );
  assert.equal(evaluateAdminSession({ sessionId: SESSION, resolved: [] }).status, 401);
  assert.equal(evaluateAdminSession({ sessionId: null, resolved: liveRow() }).status, 401);
  assert.equal(
    evaluateAdminSession({ sessionId: SESSION, resolved: liveRow({ staff_role: 'agent' }) }).status,
    403,
  );
});

test('a refreshed token from a revoked session stays blocked', () => {
  const refreshedToken = fakeJwt({
    sub: AUTH_USER,
    session_id: SESSION,
    iat: Date.parse('2026-06-01T11:59:00Z') / 1000,
  });
  assert.equal(sessionIdFromJwt(refreshedToken), SESSION);
  const revokedSessionLookup = [];
  assert.deepEqual(
    evaluateAdminSession({ sessionId: sessionIdFromJwt(refreshedToken), resolved: revokedSessionLookup }),
    { ok: false, status: 401, error: 'Sesión revocada o no válida.' },
  );
});

test('a new login after revocation gets a new session and succeeds', () => {
  const newSession = '5b1c2d3e-0000-4000-8000-000000000099';
  const token = fakeJwt({ sub: AUTH_USER, session_id: newSession });
  assert.equal(
    evaluateAdminSession({ sessionId: sessionIdFromJwt(token), resolved: liveRow() }).ok,
    true,
  );
});

test('session id is read only from a well-formed token', () => {
  assert.equal(sessionIdFromJwt('not-a-jwt'), null);
  assert.equal(sessionIdFromJwt(fakeJwt({ sub: AUTH_USER })), null);
});

test('state is rejected when missing, reused, expired, or not bound to a session', () => {
  const future = new Date(NOW + 60_000).toISOString();
  const bound = { session_id: SESSION, auth_user_id: AUTH_USER, expires_at: future, used_at: null };
  assert.deepEqual(evaluateStateRow(null, NOW), { ok: false, reason: 'missing' });
  assert.deepEqual(evaluateStateRow({ ...bound, session_id: null }, NOW), { ok: false, reason: 'missing' });
  assert.deepEqual(
    evaluateStateRow({ ...bound, used_at: '2026-06-01T11:59:00Z' }, NOW),
    { ok: false, reason: 'used' },
  );
  assert.deepEqual(
    evaluateStateRow({ ...bound, expires_at: new Date(NOW - 1).toISOString() }, NOW),
    { ok: false, reason: 'expired' },
  );
  assert.equal(evaluateStateRow(bound, NOW).ok, true);
});

test('logout, revocation, disablement, or a changed account blocks Google completion', () => {
  assert.deepEqual(evaluateStateSession([], STAFF), { ok: false, reason: 'session-ended' });
  assert.deepEqual(evaluateStateSession(null, STAFF), { ok: false, reason: 'session-ended' });
  assert.deepEqual(evaluateStateSession(liveRow({ staff_id: 'agent-100002' }), STAFF), {
    ok: false,
    reason: 'staff-changed',
  });
  assert.deepEqual(evaluateStateSession(liveRow({ staff_role: 'agent' }), STAFF), {
    ok: false,
    reason: 'not-admin',
  });
  assert.deepEqual(evaluateStateSession(liveRow(), STAFF), { ok: true });
});

test('partial consent is reported as missing read, missing send, or both', () => {
  const readOnly = evaluateGrantedScopes([GMAIL_READ_SCOPE]);
  assert.equal(readOnly.fullyAuthorized, false);
  assert.match(describeMissingPermissions(readOnly), /enviar correos/);

  const sendOnly = evaluateGrantedScopes([GMAIL_SEND_SCOPE]);
  assert.equal(sendOnly.fullyAuthorized, false);
  assert.match(describeMissingPermissions(sendOnly), /leer los correos/);

  const none = evaluateGrantedScopes([]);
  assert.match(describeMissingPermissions(none), /leer ni para enviar/);

  const both = evaluateGrantedScopes([GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE, GMAIL_SEND_SCOPE]);
  assert.equal(both.fullyAuthorized, true);
  assert.deepEqual(both.granted, [GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE]);
  assert.equal(describeMissingPermissions(both), null);
});

test('mailbox matching is case-insensitive and rejects other accounts', () => {
  assert.equal(mailboxMatches(BUSINESS_MAILBOX.toUpperCase()), true);
  assert.equal(mailboxMatches('  plw@professionallatinoworker2026.com '), true);
  assert.equal(mailboxMatches('owner@professionallatinoworker2026.com'), false);
  assert.equal(mailboxMatches(''), false);
});

test('mailbox mismatch explains alias and group setups', () => {
  const message = mailboxMismatchMessage('Owner@Professionallatinoworker2026.com');
  assert.match(message, /owner@professionallatinoworker2026\.com/);
  assert.match(message, /alias/);
  assert.match(message, /grupo/);
});

test('refresh failure asks for reconnection only when Google rejects the grant', () => {
  assert.equal(describeRefreshFailure('invalid_grant').reconnectRequired, true);
  assert.equal(describeRefreshFailure('temporarily_unavailable').reconnectRequired, false);
});

test('missing secrets are reported by name, including an invalid encryption key', () => {
  const validKey = Buffer.alloc(32, 1).toString('base64');
  assert.deepEqual(missingSecrets({}), [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'PLW_GOOGLE_TOKEN_KEY',
    'PLW_APP_ORIGIN',
  ]);
  assert.deepEqual(
    missingSecrets({
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      PLW_GOOGLE_TOKEN_KEY: Buffer.alloc(8).toString('base64'),
      PLW_APP_ORIGIN: 'https://example.com',
    }),
    ['PLW_GOOGLE_TOKEN_KEY'],
  );
  assert.deepEqual(
    missingSecrets({
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      PLW_GOOGLE_TOKEN_KEY: validKey,
      PLW_APP_ORIGIN: 'https://example.com',
    }),
    [],
  );
});

test('authorization URL requests offline access and only the two Gmail scopes', () => {
  const url = new URL(
    buildAuthorizationUrl({
      clientId: 'client-id',
      redirectUri: 'https://proj.supabase.co/functions/v1/google-workspace/oauth/callback',
      state: 'state-value',
    }),
  );
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('state'), 'state-value');
  assert.equal(url.searchParams.get('login_hint'), BUSINESS_MAILBOX);
  assert.equal(
    url.searchParams.get('scope'),
    'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
  );
});

test('code exchange returns the scopes Google actually granted', async () => {
  const ok = await exchangeAuthorizationCode(
    async () =>
      jsonResponse(200, {
        access_token: 'a',
        refresh_token: 'r',
        scope: `${GMAIL_READ_SCOPE} ${GMAIL_SEND_SCOPE}`,
      }),
    { clientId: 'c', clientSecret: 's', code: 'x', redirectUri: 'u' },
  );
  assert.deepEqual(ok, {
    accessToken: 'a',
    refreshToken: 'r',
    scopes: [GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE],
  });

  const partial = await exchangeAuthorizationCode(
    async () => jsonResponse(200, { access_token: 'a', refresh_token: 'r', scope: GMAIL_READ_SCOPE }),
    { clientId: 'c', clientSecret: 's', code: 'x', redirectUri: 'u' },
  );
  assert.deepEqual(partial.scopes, [GMAIL_READ_SCOPE]);

  await assert.rejects(
    exchangeAuthorizationCode(async () => jsonResponse(400, { error: 'invalid_grant' }), {
      clientId: 'c',
      clientSecret: 's',
      code: 'x',
      redirectUri: 'u',
    }),
    (error) => error instanceof GoogleApiError && error.code === 'invalid_grant',
  );
});

test('refresh returns the access token and any scope Google reports', async () => {
  const refreshed = await refreshAccessToken(
    async () => jsonResponse(200, { access_token: 'a', scope: GMAIL_SEND_SCOPE }),
    { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
  );
  assert.deepEqual(refreshed, { accessToken: 'a', scopes: [GMAIL_SEND_SCOPE] });

  await assert.rejects(
    refreshAccessToken(async () => jsonResponse(400, { error: 'invalid_grant' }), {
      clientId: 'c',
      clientSecret: 's',
      refreshToken: 'r',
    }),
    (error) => error instanceof GoogleApiError && error.code === 'invalid_grant',
  );
});

test('disconnect reports revocation only when Google confirms it', async () => {
  assert.equal(await revokeToken(async () => jsonResponse(200, {}), 'r'), true);
  assert.equal(await revokeToken(async () => jsonResponse(400, { error: 'invalid_token' }), 'r'), false);
  assert.equal(
    await revokeToken(async () => {
      throw new TypeError('network down');
    }, 'r'),
    false,
  );
});

test('mailbox lookup returns the authorized address and rejects failed profile calls', async () => {
  const address = await fetchMailboxAddress(
    async () => jsonResponse(200, { emailAddress: BUSINESS_MAILBOX }),
    'token',
  );
  assert.equal(address, BUSINESS_MAILBOX);
  await assert.rejects(
    fetchMailboxAddress(async () => jsonResponse(401, { error: 'unauthorized' }), 'token'),
    (error) => error instanceof GoogleApiError && error.code === 'profile_failed',
  );
});

test('refresh tokens round-trip through encryption and fail with the wrong key', async () => {
  const ciphertext = await encryptRefreshToken('refresh-value', KEY);
  assert.notEqual(ciphertext, 'refresh-value');
  assert.equal(await decryptRefreshToken(ciphertext, KEY), 'refresh-value');

  const otherKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  await assert.rejects(decryptRefreshToken(ciphertext, otherKey));
});
