import { evaluateAdminSession, sessionIdFromJwt } from './rules.js';

export const STAFF_ID_PATTERN = /^agent-[0-9]+$/;
const PIN_PATTERN = /^[0-9]{4}$/;
const DISPLAY_NAME_MAX = 60;
const ENROLLMENT_LABEL_MAX = 80;
const CAPACITY_MAX = 200;

function fail(status, error) {
  return { status, body: { error } };
}

function isString(value, min, max) {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function isStaffId(value) {
  return isString(value, 1, 40) && STAFF_ID_PATTERN.test(value);
}

function isCapacity(value) {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= CAPACITY_MAX);
}

export async function authorizeAdmin({ admin, jwt }) {
  const sessionId = sessionIdFromJwt(jwt);
  const { data: userData, error } = await admin.auth.getUser(jwt);
  if (error || !userData?.user) {
    return { ok: false, status: 401, body: { error: 'Sesión no válida.' } };
  }

  const { data: resolved, error: resolveError } = sessionId
    ? await admin.rpc('resolve_staff_session', {
        p_session_id: sessionId,
        p_auth_user_id: userData.user.id,
      })
    : { data: null, error: null };
  if (resolveError) throw resolveError;

  const decision = evaluateAdminSession({ sessionId, resolved });
  if (!decision.ok) {
    return { ok: false, status: decision.status, body: { error: decision.error } };
  }
  return { ok: true, status: 200, body: {}, actorId: decision.staffId };
}

async function revokeStaffAccess(admin, staffId) {
  const { error } = await admin.rpc('revoke_staff_sessions', { p_staff_id: staffId });
  if (error) throw error;
}

async function handleListAgents(userClient) {
  const { data, error } = await userClient.rpc('admin_list_agents');
  if (error || !Array.isArray(data)) {
    return fail(500, 'No se pudo cargar los agentes. Intente de nuevo.');
  }
  const agents = data.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    isEnabled: row.is_enabled,
    maxActiveProspects: row.max_active_prospects,
    hasPin: row.has_pin,
  }));
  return { status: 200, body: { agents } };
}

async function handleSetSecret(admin, actorId, body) {
  const { staffId, kind, secret } = body;
  if (!isStaffId(staffId)) return fail(400, 'Agente no válido.');
  if (kind !== 'pin') return fail(400, 'Tipo de credencial no válido.');
  if (!isString(secret, 4, 4) || !PIN_PATTERN.test(secret)) {
    return fail(400, 'El PIN debe tener exactamente cuatro dígitos.');
  }

  const { error } = await admin.rpc('set_staff_secret', {
    p_actor_id: actorId,
    p_staff_id: staffId,
    p_kind: kind,
    p_secret: secret,
  });
  if (error) return fail(422, error.message);

  await revokeStaffAccess(admin, staffId);
  return { status: 200, body: { status: 'ok' } };
}

async function handleUpdateStaff(admin, userClient, body) {
  const { staffId, displayName, isEnabled, maxActiveProspects } = body;
  if (!isStaffId(staffId)) return fail(400, 'Agente no válido.');
  if (!isString(displayName, 1, DISPLAY_NAME_MAX) || typeof isEnabled !== 'boolean') {
    return fail(400, 'Datos del agente no válidos.');
  }
  if (!isCapacity(maxActiveProspects)) return fail(400, 'El límite no es válido.');

  const { error } = await userClient.rpc('admin_update_staff', {
    p_staff_id: staffId,
    p_display_name: displayName,
    p_is_enabled: isEnabled,
    p_max_active_prospects: maxActiveProspects,
  });
  if (error) return fail(422, error.message);

  if (!isEnabled) await revokeStaffAccess(admin, staffId);
  return { status: 200, body: { status: 'ok' } };
}

async function handleRevokeSessions(admin, body) {
  const { staffId } = body;
  if (!isStaffId(staffId)) return fail(400, 'Agente no válido.');
  await revokeStaffAccess(admin, staffId);
  return { status: 200, body: { status: 'ok' } };
}

async function handleCreateEnrollment(userClient, body) {
  const { label } = body;
  if (!isString(label, 1, ENROLLMENT_LABEL_MAX) || label.trim().length === 0) {
    return fail(400, 'La etiqueta del equipo debe tener entre 1 y 80 caracteres.');
  }

  const { data, error } = await userClient.rpc('admin_create_device_enrollment', {
    p_label: label,
  });
  if (error) return fail(422, error.message);
  if (typeof data !== 'string' || data.length === 0) {
    return fail(500, 'No se pudo crear el código. Intente de nuevo.');
  }
  return { status: 200, body: { code: data, label: label.trim() } };
}

export async function handleAdminAction({ admin, userClient, actorId, body }) {
  switch (body.action) {
    case 'list_agents':
      return handleListAgents(userClient);
    case 'set_secret':
      return handleSetSecret(admin, actorId, body);
    case 'update_staff':
      return handleUpdateStaff(admin, userClient, body);
    case 'revoke_sessions':
      return handleRevokeSessions(admin, body);
    case 'create_enrollment':
      return handleCreateEnrollment(userClient, body);
    default:
      return fail(400, 'Acción no válida.');
  }
}
