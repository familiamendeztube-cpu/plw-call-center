import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  evaluateAdminSession,
  sessionIdFromJwt,
} from '../../supabase/functions/admin-actions/rules.js';

const SESSION = '5b1c2d3e-0000-4000-8000-000000000001';
const ADMIN_SESSION = '5b1c2d3e-0000-4000-8000-000000000003';

function fakeJwt(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}

test('admin actions authorize only a live administrator session', () => {
  assert.equal(
    evaluateAdminSession({
      sessionId: ADMIN_SESSION,
      resolved: [{ staff_id: 'agent-100001', staff_role: 'admin' }],
    }).ok,
    true,
  );
  assert.equal(evaluateAdminSession({ sessionId: SESSION, resolved: [] }).status, 401);
  assert.equal(
    evaluateAdminSession({
      sessionId: SESSION,
      resolved: [{ staff_id: 'agent-100002', staff_role: 'agent' }],
    }).status,
    403,
  );
});

test('a refreshed token keeps its session and is blocked once that session is revoked', () => {
  const refreshed = fakeJwt({ sub: 'user', session_id: SESSION, iat: 1_900_000_000 });
  assert.deepEqual(
    evaluateAdminSession({ sessionId: sessionIdFromJwt(refreshed), resolved: [] }),
    { ok: false, status: 401, error: 'Sesión revocada o no válida.' },
  );
});

test('revoking a staff member does not sign out the administrator', () => {
  const adminFunction = ['index.ts', 'handlers.js']
    .map((file) =>
      readFileSync(new URL(`../../supabase/functions/admin-actions/${file}`, import.meta.url), 'utf8'),
    )
    .join('\n');
  assert.doesNotMatch(adminFunction, /auth\.admin\.signOut/);
  assert.match(adminFunction, /rpc\('revoke_staff_sessions'/);
});
