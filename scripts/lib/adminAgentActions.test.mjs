import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeAdmin,
  handleAdminAction,
} from '../../supabase/functions/admin-actions/handlers.js';

const ADMIN = { staffId: 'admin-1', authUserId: 'auth-admin', sessionId: 'session-admin' };
const JWT = `header.${Buffer.from(JSON.stringify({ session_id: ADMIN.sessionId })).toString('base64url')}.sig`;

function createFixture() {
  const staff = new Map([
    ['admin-1', { role: 'admin', displayName: 'Administrador', isEnabled: true, max: null }],
    ['agent-1', { role: 'agent', displayName: 'Agente 1', isEnabled: true, max: 12 }],
    ['agent-2', { role: 'agent', displayName: 'Agente 2', isEnabled: false, max: 4 }],
    ['agent-3', { role: 'agent', displayName: 'Agente 3', isEnabled: true, max: null }],
  ]);
  const pins = new Map([['agent-1', 'hash-1']]);
  const sessions = new Map([[ADMIN.sessionId, { authUserId: ADMIN.authUserId, staffId: 'admin-1' }]]);
  const calls = [];
  const revoked = [];
  const enrollments = [];

  const liveAdminRow = (sessionId, authUserId) => {
    const session = sessions.get(sessionId);
    if (!session || session.authUserId !== authUserId) return [];
    const profile = staff.get(session.staffId);
    if (!profile || !profile.isEnabled) return [];
    return [{ staff_id: session.staffId, staff_role: profile.role }];
  };

  const adminRpc = async (name, args) => {
    calls.push({ client: 'admin', name, args });
    if (name === 'resolve_staff_session') {
      return { data: liveAdminRow(args.p_session_id, args.p_auth_user_id), error: null };
    }
    if (name === 'set_staff_secret') {
      if (!/^[0-9]{4}$/.test(args.p_secret)) {
        return { data: null, error: { message: 'El PIN debe tener exactamente cuatro dígitos.' } };
      }
      pins.set(args.p_staff_id, 'hash-new');
      return { data: null, error: null };
    }
    if (name === 'revoke_staff_sessions') {
      revoked.push(args.p_staff_id);
      return { data: null, error: null };
    }
    throw new Error(`unexpected admin rpc ${name}`);
  };

  const userRpc = async (name, args) => {
    calls.push({ client: 'user', name, args });
    if (name === 'admin_list_agents') {
      const rows = [...staff.entries()]
        .filter(([, profile]) => profile.role === 'agent')
        .map(([id, profile]) => ({
          id,
          display_name: profile.displayName,
          is_enabled: profile.isEnabled,
          max_active_prospects: profile.max,
          has_pin: pins.has(id),
          pin_hash: pins.get(id) ?? null,
        }));
      return { data: rows, error: null };
    }
    if (name === 'admin_update_staff') {
      if (args.p_is_enabled && !pins.has(args.p_staff_id)) {
        return {
          data: null,
          error: { message: 'Configure primero el PIN de este agente antes de habilitarlo.' },
        };
      }
      const profile = staff.get(args.p_staff_id);
      profile.displayName = args.p_display_name;
      profile.isEnabled = args.p_is_enabled;
      profile.max = args.p_max_active_prospects;
      return { data: null, error: null };
    }
    if (name === 'admin_create_device_enrollment') {
      if (!args.p_label.trim()) return { data: null, error: { message: 'Etiqueta inválida.' } };
      const code = `CODE${enrollments.length + 1}`;
      enrollments.push({ label: args.p_label.trim(), code });
      return { data: code, error: null };
    }
    throw new Error(`unexpected user rpc ${name}`);
  };

  const admin = {
    auth: {
      async getUser(jwt) {
        return jwt === JWT
          ? { data: { user: { id: ADMIN.authUserId } }, error: null }
          : { data: { user: null }, error: { message: 'bad jwt' } };
      },
    },
    rpc: adminRpc,
  };
  const userClient = { rpc: userRpc };

  return { staff, pins, revoked, enrollments, calls, admin, userClient, sessions };
}

async function run(fixture, body, jwt = JWT) {
  const auth = await authorizeAdmin({ admin: fixture.admin, jwt });
  if (!auth.ok) return { status: auth.status, body: auth.body };
  return handleAdminAction({
    admin: fixture.admin,
    userClient: fixture.userClient,
    actorId: auth.actorId,
    body,
  });
}

test('requests without a live admin session are rejected before any action runs', async () => {
  const fixture = createFixture();
  const missing = await run(fixture, { action: 'list_agents' }, 'not-a-jwt');
  assert.equal(missing.status, 401);

  fixture.sessions.set(ADMIN.sessionId, { authUserId: ADMIN.authUserId, staffId: 'agent-1' });
  const agentSession = await run(fixture, { action: 'list_agents' });
  assert.equal(agentSession.status, 403);
  assert.equal(fixture.calls.some((call) => call.name === 'admin_list_agents'), false);
});

test('a disabled administrator session is refused', async () => {
  const fixture = createFixture();
  fixture.staff.get('admin-1').isEnabled = false;
  const result = await run(fixture, { action: 'list_agents' });
  assert.equal(result.status, 401);
});

test('list includes disabled agents and reports PIN presence without any stored secret', async () => {
  const fixture = createFixture();
  const result = await run(fixture, { action: 'list_agents' });
  assert.equal(result.status, 200);
  const ids = result.body.agents.map((agent) => agent.id);
  assert.deepEqual(ids, ['agent-1', 'agent-2', 'agent-3']);
  const disabled = result.body.agents.find((agent) => agent.id === 'agent-2');
  assert.equal(disabled.isEnabled, false);
  assert.equal(disabled.hasPin, false);
  assert.equal(result.body.agents[0].hasPin, true);
  const serialized = JSON.stringify(result.body);
  assert.equal(serialized.includes('hash-1'), false);
  assert.equal(serialized.includes('pin_hash'), false);
});

test('PIN configuration accepts exactly four digits and confirms only after the server succeeds', async () => {
  const fixture = createFixture();
  const bad = await run(fixture, { action: 'set_secret', staffId: 'agent-2', kind: 'pin', secret: '12a4' });
  assert.equal(bad.status, 400);
  assert.equal(fixture.calls.some((call) => call.name === 'set_staff_secret'), false);

  const ok = await run(fixture, { action: 'set_secret', staffId: 'agent-2', kind: 'pin', secret: '4821' });
  assert.deepEqual(ok, { status: 200, body: { status: 'ok' } });
  assert.deepEqual(fixture.revoked, ['agent-2']);
  assert.equal(fixture.pins.has('agent-2'), true);
  assert.equal(JSON.stringify(ok).includes('4821'), false);
});

test('non-PIN credential kinds are refused before the database and sessions stay untouched', async () => {
  const fixture = createFixture();
  const result = await run(fixture, { action: 'set_secret', staffId: 'agent-2', kind: 'passcode', secret: '4821' });
  assert.equal(result.status, 400);
  assert.deepEqual(fixture.revoked, []);
});

test('an agent without a PIN cannot be enabled, and enabling succeeds once a PIN exists', async () => {
  const fixture = createFixture();
  const blocked = await run(fixture, {
    action: 'update_staff',
    staffId: 'agent-2',
    displayName: 'Agente 2',
    isEnabled: true,
    maxActiveProspects: 6,
  });
  assert.equal(blocked.status, 422);
  assert.equal(fixture.staff.get('agent-2').isEnabled, false);

  await run(fixture, { action: 'set_secret', staffId: 'agent-2', kind: 'pin', secret: '3307' });
  const enabled = await run(fixture, {
    action: 'update_staff',
    staffId: 'agent-2',
    displayName: 'Agente Dos',
    isEnabled: true,
    maxActiveProspects: 6,
  });
  assert.deepEqual(enabled, { status: 200, body: { status: 'ok' } });
  assert.equal(fixture.staff.get('agent-2').isEnabled, true);
  assert.equal(fixture.staff.get('agent-2').displayName, 'Agente Dos');
  assert.equal(fixture.staff.get('agent-2').max, 6);
});

test('disabling an agent revokes their sessions and capacity must be a whole number in range', async () => {
  const fixture = createFixture();
  const disabled = await run(fixture, {
    action: 'update_staff',
    staffId: 'agent-3',
    displayName: 'Agente 3',
    isEnabled: false,
    maxActiveProspects: null,
  });
  assert.equal(disabled.status, 200);
  assert.deepEqual(fixture.revoked, ['agent-3']);

  const fractional = await run(fixture, {
    action: 'update_staff',
    staffId: 'agent-1',
    displayName: 'Agente 1',
    isEnabled: true,
    maxActiveProspects: 2.5,
  });
  assert.equal(fractional.status, 400);
});

test('only agent identifiers are accepted for agent actions', async () => {
  const fixture = createFixture();
  const result = await run(fixture, { action: 'revoke_sessions', staffId: 'admin-1' });
  assert.equal(result.status, 400);
  assert.deepEqual(fixture.revoked, []);
});

test('revoking sessions targets only the selected agent', async () => {
  const fixture = createFixture();
  const result = await run(fixture, { action: 'revoke_sessions', staffId: 'agent-1' });
  assert.deepEqual(result, { status: 200, body: { status: 'ok' } });
  assert.deepEqual(fixture.revoked, ['agent-1']);
});

test('office enrollment creates a code through the administrator path and returns it once', async () => {
  const fixture = createFixture();
  const result = await run(fixture, { action: 'create_enrollment', label: '  Recepción  ' });
  assert.deepEqual(result, { status: 200, body: { code: 'CODE1', label: 'Recepción' } });
  assert.deepEqual(fixture.enrollments, [{ label: 'Recepción', code: 'CODE1' }]);
});

test('enrollment rejects an empty or oversized label', async () => {
  const fixture = createFixture();
  const empty = await run(fixture, { action: 'create_enrollment', label: '   ' });
  assert.equal(empty.status, 400);
  assert.equal(fixture.calls.some((call) => call.name === 'admin_create_device_enrollment'), false);

  const refused = await run(fixture, { action: 'create_enrollment', label: 'x'.repeat(81) });
  assert.equal(refused.status, 400);
});

test('unknown actions are refused', async () => {
  const fixture = createFixture();
  const result = await run(fixture, { action: 'delete_everything' });
  assert.equal(result.status, 400);
});
