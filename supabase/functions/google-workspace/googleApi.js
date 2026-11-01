import { BUSINESS_DOMAIN, BUSINESS_MAILBOX, GOOGLE_SCOPES } from './rules.js';

const AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';

export class GoogleApiError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'GoogleApiError';
    this.code = code;
    this.status = status;
  }
}

export function buildAuthorizationUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
    login_hint: BUSINESS_MAILBOX,
    hd: BUSINESS_DOMAIN,
  });
  return `${AUTHORIZATION_URL}?${params.toString()}`;
}

async function postForm(fetchImpl, url, fields) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

function parseGrantedScopes(scopeText) {
  return typeof scopeText === 'string' ? scopeText.split(/\s+/).filter(Boolean) : [];
}

export async function exchangeAuthorizationCode(fetchImpl, { clientId, clientSecret, code, redirectUri }) {
  const result = await postForm(fetchImpl, TOKEN_URL, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  if (!result.ok || typeof result.data?.access_token !== 'string') {
    throw new GoogleApiError(result.data?.error ?? 'exchange_failed', result.status);
  }
  return {
    accessToken: result.data.access_token,
    refreshToken: typeof result.data.refresh_token === 'string' ? result.data.refresh_token : null,
    scopes: parseGrantedScopes(result.data.scope),
  };
}

export async function refreshAccessToken(fetchImpl, { clientId, clientSecret, refreshToken }) {
  const result = await postForm(fetchImpl, TOKEN_URL, {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (!result.ok || typeof result.data?.access_token !== 'string') {
    throw new GoogleApiError(result.data?.error ?? 'refresh_failed', result.status);
  }
  return {
    accessToken: result.data.access_token,
    scopes: parseGrantedScopes(result.data.scope),
  };
}

export async function revokeToken(fetchImpl, token) {
  try {
    const result = await postForm(fetchImpl, REVOKE_URL, { token });
    return result.ok;
  } catch {
    return false;
  }
}

export async function fetchMailboxAddress(fetchImpl, accessToken) {
  const response = await fetchImpl(PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || typeof data?.emailAddress !== 'string') {
    throw new GoogleApiError('profile_failed', response.status);
  }
  return data.emailAddress;
}
