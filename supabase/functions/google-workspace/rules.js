export const BUSINESS_MAILBOX = 'Plw@professionallatinoworker2026.com';
export const BUSINESS_DOMAIN = 'professionallatinoworker2026.com';
export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GOOGLE_SCOPES = [GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE];
export const STATE_TTL_MS = 10 * 60 * 1000;
export const MIN_TOKEN_KEY_LENGTH = 32;
export const REQUIRED_SECRETS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'PLW_GOOGLE_TOKEN_KEY',
  'PLW_APP_ORIGIN',
];

export function normalizeMailbox(address) {
  return typeof address === 'string' ? address.trim().toLowerCase() : '';
}

export function missingSecrets(env) {
  return REQUIRED_SECRETS.filter((name) => {
    const value = env[name];
    if (typeof value !== 'string' || value.trim().length === 0) return true;
    return name === 'PLW_GOOGLE_TOKEN_KEY' && value.length < MIN_TOKEN_KEY_LENGTH;
  });
}

export function sessionIdFromJwt(jwt) {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.session_id === 'string' ? payload.session_id : null;
  } catch {
    return null;
  }
}

function firstRow(resolved) {
  if (Array.isArray(resolved)) return resolved[0] ?? null;
  return resolved ?? null;
}

export function evaluateAdminSession({ sessionId, resolved }) {
  const row = firstRow(resolved);
  if (!sessionId || !row) return { ok: false, status: 401, error: 'Sesión revocada o no válida.' };
  if (row.staff_role !== 'admin') return { ok: false, status: 403, error: 'No autorizado.' };
  return { ok: true, staffId: row.staff_id };
}

export function evaluateStaffSession({ sessionId, resolved }) {
  const row = firstRow(resolved);
  if (!sessionId || !row || !row.staff_id) return { ok: false, status: 401, error: 'Sesión revocada o no válida.' };
  return { ok: true, staffId: row.staff_id };
}

export function evaluateStateRow(row, nowMs) {
  if (!row || !row.session_id || !row.auth_user_id) return { ok: false, reason: 'missing' };
  if (row.used_at) return { ok: false, reason: 'used' };
  if (Date.parse(row.expires_at) <= nowMs) return { ok: false, reason: 'expired' };
  return { ok: true };
}

export function evaluateStateSession(resolved, stateStaffId) {
  const row = firstRow(resolved);
  if (!row) return { ok: false, reason: 'session-ended' };
  if (row.staff_id !== stateStaffId) return { ok: false, reason: 'staff-changed' };
  if (row.staff_role !== 'admin') return { ok: false, reason: 'not-admin' };
  return { ok: true };
}

export function evaluateGrantedScopes(scopes) {
  const granted = [...new Set(Array.isArray(scopes) ? scopes : [])];
  const readGranted = granted.includes(GMAIL_READ_SCOPE);
  const sendGranted = granted.includes(GMAIL_SEND_SCOPE);
  return { granted, readGranted, sendGranted, fullyAuthorized: readGranted && sendGranted };
}

export function describeMissingPermissions({ readGranted, sendGranted }) {
  if (readGranted && sendGranted) return null;
  if (!readGranted && !sendGranted) {
    return 'Google no concedió los permisos para leer ni para enviar correos del buzón. Vuelva a conectar la cuenta y acepte los dos permisos de Gmail.';
  }
  if (!readGranted) {
    return 'Google no concedió el permiso para leer los correos del buzón. Vuelva a conectar la cuenta y acepte el permiso de lectura de Gmail.';
  }
  return 'Google no concedió el permiso para enviar correos desde el buzón. Vuelva a conectar la cuenta y acepte el permiso de envío de Gmail.';
}

export function mailboxMatches(emailAddress) {
  return normalizeMailbox(emailAddress) === normalizeMailbox(BUSINESS_MAILBOX);
}

export function mailboxMismatchMessage(emailAddress) {
  const account = normalizeMailbox(emailAddress) || 'una cuenta desconocida';
  return (
    `Google autorizó la cuenta ${account}, no el buzón ${BUSINESS_MAILBOX}. ` +
    'Si ese buzón es un alias o un grupo de Google, la autorización debe hacerse con la cuenta ' +
    'principal del buzón que tiene acceso a sus mensajes. Un alias o un grupo no puede ' +
    'autorizarse por sí solo. Inicie sesión con la cuenta correcta e intente de nuevo.'
  );
}

export function describeRefreshFailure(errorCode) {
  if (errorCode === 'invalid_grant') {
    return {
      reconnectRequired: true,
      message:
        'La autorización de Google venció o fue revocada. Vuelva a conectar la cuenta del buzón.',
    };
  }
  return {
    reconnectRequired: false,
    message: 'Google no respondió al verificar la conexión. Intente de nuevo en unos minutos.',
  };
}
