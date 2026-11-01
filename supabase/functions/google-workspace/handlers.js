import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  fetchMailboxAddress,
  GoogleApiError,
  refreshAccessToken,
  revokeToken,
} from './googleApi.js';
import {
  BUSINESS_MAILBOX,
  describeMissingPermissions,
  describeRefreshFailure,
  evaluateGrantedScopes,
  evaluateStateRow,
  evaluateStateSession,
  mailboxMatches,
  mailboxMismatchMessage,
  missingSecrets,
  normalizeMailbox,
  STATE_TTL_MS,
} from './rules.js';
import { decryptRefreshToken, encryptRefreshToken } from './tokenCrypto.js';

export const MAILBOX_KEY = normalizeMailbox(BUSINESS_MAILBOX);
const REVOKE_NOT_CONFIRMED_MESSAGE =
  'El acceso se eliminó del servidor, pero Google no confirmó la revocación. Revoque la aplicación desde la seguridad de la cuenta del buzón.';
const UNREADABLE_TOKEN_MESSAGE =
  'No se pudo leer la autorización guardada. Vuelva a conectar la cuenta del buzón.';
const SESSION_ENDED_MESSAGE =
  'Su sesión de administrador ya no permite completar esta acción. Inicie sesión de nuevo.';
const SUPERSEDED_MESSAGE =
  'La conexión cambió mientras Google respondía. Revise el estado de la conexión e intente de nuevo.';
const NOT_CONNECTED_MESSAGE = 'No había una cuenta conectada.';

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function guardFor(actor, expectedVersion) {
  return {
    expectedVersion,
    sessionId: actor.sessionId,
    authUserId: actor.authUserId,
    staffId: actor.id,
  };
}

function resultMessage(reason, message) {
  if (reason === 'saved') return message;
  return reason === 'session-ended' ? SESSION_ENDED_MESSAGE : SUPERSEDED_MESSAGE;
}

export function toPublicConnection(row) {
  const permissions = evaluateGrantedScopes(row?.scopes ?? []);
  return {
    status: row?.status ?? 'disconnected',
    connectedAccount: row?.connected_account ?? null,
    connectedAt: row?.connected_at ?? null,
    lastVerifiedAt: row?.last_verified_at ?? null,
    lastError: row?.last_error ?? null,
    permissions: { gmailRead: permissions.readGranted, gmailSend: permissions.sendGranted },
    fullyAuthorized: row?.status === 'connected' && permissions.fullyAuthorized,
  };
}

export async function handleStatus({ db, env, callbackUrl }) {
  const missing = missingSecrets(env);
  const row = await db.getConnection();
  return {
    status: 200,
    body: {
      configured: missing.length === 0,
      missing,
      callbackUrl,
      mailbox: BUSINESS_MAILBOX,
      connection: toPublicConnection(row),
    },
  };
}

export async function handleStart({ db, env, callbackUrl }, actor) {
  const missing = missingSecrets(env);
  if (missing.length > 0) {
    return { status: 409, body: { error: 'Falta configuración en el servidor.', missing } };
  }

  const row = await db.getConnection();
  const state = randomState();
  await db.createState({
    stateHash: await sha256Hex(state),
    staffId: actor.id,
    authUserId: actor.authUserId,
    sessionId: actor.sessionId,
    connectionVersion: row?.connection_version ?? 0,
    expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });

  return {
    status: 200,
    body: {
      authorizationUrl: buildAuthorizationUrl({
        clientId: env.GOOGLE_CLIENT_ID,
        redirectUri: callbackUrl,
        state,
      }),
    },
  };
}

async function recordFailure(db, guard, message, reconnectRequired) {
  const patch = reconnectRequired
    ? { status: 'error', refresh_token_ciphertext: null, last_error: message }
    : { status: 'error', last_error: message };
  const reason = await db.saveConnection(guard, patch, null);
  return { verified: false, message: resultMessage(reason, message) };
}

async function refreshedMailboxCheck({ db, env, fetchImpl }, guard, row) {
  let refreshToken;
  try {
    refreshToken = await decryptRefreshToken(row.refresh_token_ciphertext, env.PLW_GOOGLE_TOKEN_KEY);
  } catch {
    return recordFailure(db, guard, UNREADABLE_TOKEN_MESSAGE, true);
  }

  let refreshed;
  let account;
  try {
    refreshed = await refreshAccessToken(fetchImpl, {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      refreshToken,
    });
    account = await fetchMailboxAddress(fetchImpl, refreshed.accessToken);
  } catch (error) {
    const code = error instanceof GoogleApiError ? error.code : 'unknown';
    const described = describeRefreshFailure(code);
    return recordFailure(db, guard, described.message, described.reconnectRequired);
  }

  if (!mailboxMatches(account)) {
    return recordFailure(db, guard, mailboxMismatchMessage(account), true);
  }

  const granted = refreshed.scopes.length > 0 ? refreshed.scopes : (row.scopes ?? []);
  const permissions = evaluateGrantedScopes(granted);
  const missingMessage = describeMissingPermissions(permissions);
  if (missingMessage) {
    await revokeToken(fetchImpl, refreshToken);
    const reason = await db.saveConnection(
      guard,
      { status: 'error', refresh_token_ciphertext: null, last_error: missingMessage, scopes: permissions.granted },
      null,
    );
    return { verified: false, message: resultMessage(reason, missingMessage) };
  }

  const reason = await db.saveConnection(
    guard,
    {
      status: 'connected',
      scopes: permissions.granted,
      last_verified_at: new Date().toISOString(),
      last_error: null,
    },
    null,
  );
  return reason === 'saved'
    ? { verified: true, message: null }
    : { verified: false, message: resultMessage(reason, null) };
}

export async function handleVerify(deps, actor) {
  const row = await deps.db.getConnection();
  if (!row?.refresh_token_ciphertext) {
    return { status: 409, body: { error: 'No hay una cuenta de Google conectada.' } };
  }

  const result = await refreshedMailboxCheck(deps, guardFor(actor, row.connection_version), row);
  return {
    status: 200,
    body: {
      verified: result.verified,
      message: result.message,
      connection: toPublicConnection(await deps.db.getConnection()),
    },
  };
}

export async function handleDisconnect({ db, env, fetchImpl }, actor) {
  const cleared = await db.disconnect(actor);
  if (!cleared) return { status: 401, body: { error: 'Sesión no válida.' } };

  if (!cleared.previousCiphertext) {
    return {
      status: 200,
      body: {
        providerRevoked: false,
        message: NOT_CONNECTED_MESSAGE,
        connection: toPublicConnection(await db.getConnection()),
      },
    };
  }

  let providerRevoked = false;
  try {
    const refreshToken = await decryptRefreshToken(cleared.previousCiphertext, env.PLW_GOOGLE_TOKEN_KEY);
    providerRevoked = await revokeToken(fetchImpl, refreshToken);
  } catch {
    providerRevoked = false;
  }

  const message = providerRevoked
    ? 'Acceso revocado en Google y eliminado del servidor.'
    : REVOKE_NOT_CONFIRMED_MESSAGE;
  await db.saveConnection(
    guardFor(actor, cleared.newVersion),
    { last_error: providerRevoked ? null : REVOKE_NOT_CONFIRMED_MESSAGE },
    'disconnected',
  );
  return {
    status: 200,
    body: { providerRevoked, message, connection: toPublicConnection(await db.getConnection()) },
  };
}

function saveOutcome(reason, successOutcome) {
  if (reason === 'saved') return successOutcome;
  return reason === 'session-ended' ? 'access-denied' : 'superseded';
}

export async function completeAuthorization({ db, env, fetchImpl, callbackUrl }, url) {
  if (url.searchParams.get('error')) {
    return url.searchParams.get('error') === 'access_denied' ? 'denied' : 'failed';
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return 'failed';

  const stateRow = await db.findState(await sha256Hex(state));
  if (!stateRow || !evaluateStateRow(stateRow, Date.now()).ok) return 'state-invalid';
  if (!(await db.claimState(stateRow.id))) return 'state-invalid';

  const guard = {
    expectedVersion: stateRow.connection_version,
    sessionId: stateRow.session_id,
    authUserId: stateRow.auth_user_id,
    staffId: stateRow.staff_id,
  };
  const resolved = await db.resolveSession(stateRow.session_id, stateRow.auth_user_id);
  if (!evaluateStateSession(resolved, stateRow.staff_id).ok) return 'access-denied';

  let tokens;
  try {
    tokens = await exchangeAuthorizationCode(fetchImpl, {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      code,
      redirectUri: callbackUrl,
    });
  } catch {
    return 'exchange-failed';
  }
  if (!tokens.refreshToken) return 'consent-required';
  const refreshToken = tokens.refreshToken;

  let account;
  try {
    account = await fetchMailboxAddress(fetchImpl, tokens.accessToken);
  } catch {
    await revokeToken(fetchImpl, refreshToken);
    return 'exchange-failed';
  }
  if (!mailboxMatches(account)) {
    await revokeToken(fetchImpl, refreshToken);
    return 'wrong-mailbox';
  }

  const permissions = evaluateGrantedScopes(tokens.scopes);
  const missingMessage = describeMissingPermissions(permissions);
  if (missingMessage) {
    await revokeToken(fetchImpl, refreshToken);
    const reason = await db.saveConnection(
      guard,
      { status: 'error', refresh_token_ciphertext: null, last_error: missingMessage, scopes: permissions.granted },
      null,
    );
    return saveOutcome(reason, 'permissions-missing');
  }

  const nowIso = new Date().toISOString();
  const reason = await db.saveConnection(
    guard,
    {
      status: 'connected',
      connected_account: MAILBOX_KEY,
      refresh_token_ciphertext: await encryptRefreshToken(refreshToken, env.PLW_GOOGLE_TOKEN_KEY),
      scopes: permissions.granted,
      connected_by: stateRow.staff_id,
      connected_at: nowIso,
      last_verified_at: nowIso,
      last_error: null,
    },
    null,
  );
  if (reason !== 'saved') await revokeToken(fetchImpl, refreshToken);
  return saveOutcome(reason, 'connected');
}
