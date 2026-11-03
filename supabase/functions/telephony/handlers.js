import { sessionIdFromJwt } from '../admin-actions/rules.js';
import {
  decryptRefreshToken as decryptSecret,
  encryptRefreshToken as encryptSecret,
} from '../google-workspace/tokenCrypto.js';

const SIP_USERNAME_PATTERN = /^agent-[0-9]+$/;
const SIP_DOMAIN_PATTERN = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
// A ; starts a comment in Asterisk config files, so a password can't contain one.
const SIP_PASSWORD_PATTERN = /^[^\s;]{16,128}$/;
const NOT_CONFIGURED = 'La telefonía no está configurada en el servidor.';
const UNIQUE_VIOLATION = '23505';

function fail(status, error) {
  return { status, body: { error } };
}

function isWssUrl(value) {
  if (typeof value !== 'string' || value.length > 200) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'wss:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

export async function authorizeStaff({ admin, jwt }) {
  const sessionId = sessionIdFromJwt(jwt);
  const { data: userData, error } = await admin.auth.getUser(jwt);
  if (error || !userData?.user || !sessionId) return null;

  const { data, error: resolveError } = await admin.rpc('resolve_staff_session', {
    p_session_id: sessionId,
    p_auth_user_id: userData.user.id,
  });
  if (resolveError) throw resolveError;

  const row = Array.isArray(data) ? data[0] : data;
  return row ? { staffId: row.staff_id, role: row.staff_role } : null;
}

async function handleGetMyAccount(admin, staffId, encryptionKey) {
  if (!encryptionKey) return fail(503, NOT_CONFIGURED);

  const { data, error } = await admin
    .from('agent_sip_accounts')
    .select('wss_url, sip_domain, sip_username, password_ciphertext')
    .eq('staff_id', staffId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { status: 200, body: { account: null } };

  return {
    status: 200,
    body: {
      account: {
        wssUrl: data.wss_url,
        sipDomain: data.sip_domain,
        username: data.sip_username,
        password: await decryptSecret(data.password_ciphertext, encryptionKey),
      },
    },
  };
}

async function handleListAccounts(admin) {
  const { data, error } = await admin
    .from('agent_sip_accounts')
    .select('staff_id, wss_url, sip_domain, sip_username, updated_at');
  if (error) throw error;
  return {
    status: 200,
    body: {
      accounts: data.map((row) => ({
        staffId: row.staff_id,
        wssUrl: row.wss_url,
        sipDomain: row.sip_domain,
        username: row.sip_username,
        updatedAt: row.updated_at,
      })),
    },
  };
}

async function handleSetAccount(admin, actorId, body, encryptionKey) {
  if (!encryptionKey) return fail(503, NOT_CONFIGURED);

  const { staffId, wssUrl, sipDomain, username, password } = body;
  if (typeof staffId !== 'string' || !SIP_USERNAME_PATTERN.test(staffId)) {
    return fail(400, 'Agente no válido.');
  }
  if (!isWssUrl(wssUrl)) return fail(400, 'El servidor debe ser una dirección wss:// válida.');
  if (typeof sipDomain !== 'string' || !SIP_DOMAIN_PATTERN.test(sipDomain)) {
    return fail(400, 'El dominio SIP no es válido.');
  }
  if (typeof username !== 'string' || !SIP_USERNAME_PATTERN.test(username)) {
    return fail(400, 'El usuario SIP debe tener la forma agent-1.');
  }
  if (typeof password !== 'string' || !SIP_PASSWORD_PATTERN.test(password)) {
    return fail(400, 'La contraseña SIP no es válida. Cópiala de nuevo desde el servidor.');
  }

  const { error } = await admin.rpc('set_agent_sip_account', {
    p_actor_id: actorId,
    p_staff_id: staffId,
    p_wss_url: wssUrl,
    p_sip_domain: sipDomain,
    p_sip_username: username,
    p_password_ciphertext: await encryptSecret(password, encryptionKey),
  });
  if (error?.code === UNIQUE_VIOLATION) {
    return fail(409, 'Ese usuario SIP ya está asignado a otro agente.');
  }
  if (error) return fail(422, error.message);
  return { status: 200, body: { status: 'ok' } };
}

export async function handleTelephonyAction({ admin, staff, body, encryptionKey }) {
  switch (body.action) {
    case 'call_report': {
      if (staff.role !== 'admin') return fail(403, 'No autorizado.');
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data, error, count } = await admin.from('asterisk_calls')
        .select('unique_id,linked_id,staff_id,sip_username,direction,disposition,talk_seconds,started_at,ended_at', { count: 'exact' })
        .gte('started_at', since).order('started_at', { ascending: false }).limit(10000);
      if (error) throw error;
      return { status: 200, body: { calls: data, truncated: count > data.length } };
    }
    case 'get_my_account':
      if (staff.role !== 'agent') return fail(403, 'No autorizado.');
      return handleGetMyAccount(admin, staff.staffId, encryptionKey);
    case 'list_accounts':
      if (staff.role !== 'admin') return fail(403, 'No autorizado.');
      return handleListAccounts(admin);
    case 'set_account':
      if (staff.role !== 'admin') return fail(403, 'No autorizado.');
      return handleSetAccount(admin, staff.staffId, body, encryptionKey);
    default:
      return fail(400, 'Acción no válida.');
  }
}
