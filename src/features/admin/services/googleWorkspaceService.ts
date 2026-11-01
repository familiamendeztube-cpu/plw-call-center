import {
  parseGoogleConnection,
  parseGoogleWorkspaceStatus,
  type GoogleDisconnection,
  type GoogleVerification,
  type GoogleWorkspaceStatus,
} from '@/features/admin/models/googleWorkspace';
import {
  getSupabaseClient,
  supabaseAnonKeyValue,
  supabaseFunctionsUrl,
} from '@/integrations/supabase/client';

const SESSION_ENDED = 'Tu sesión venció. Ingresa de nuevo para continuar.';
const INVALID_RESPONSE = 'La respuesta del servidor no es válida. Intenta de nuevo.';

type GoogleAction = 'status' | 'start' | 'verify' | 'disconnect';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function callGoogleWorkspace(action: GoogleAction): Promise<Record<string, unknown>> {
  const { data } = await getSupabaseClient().auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error(SESSION_ENDED);

  const response = await fetch(`${supabaseFunctionsUrl}/google-workspace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKeyValue,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : null;
    throw new Error(message ?? 'No se pudo completar la acción. Intenta de nuevo.');
  }
  if (!isRecord(payload)) throw new Error(INVALID_RESPONSE);
  return payload;
}

export async function fetchGoogleWorkspaceStatus(): Promise<GoogleWorkspaceStatus> {
  const status = parseGoogleWorkspaceStatus(await callGoogleWorkspace('status'));
  if (!status) throw new Error(INVALID_RESPONSE);
  return status;
}

export async function startGoogleAuthorization(): Promise<string> {
  const payload = await callGoogleWorkspace('start');
  if (typeof payload.authorizationUrl !== 'string') throw new Error(INVALID_RESPONSE);
  return payload.authorizationUrl;
}

export async function verifyGoogleConnection(): Promise<GoogleVerification> {
  const payload = await callGoogleWorkspace('verify');
  const connection = parseGoogleConnection(payload.connection);
  if (typeof payload.verified !== 'boolean' || !connection) throw new Error(INVALID_RESPONSE);
  return {
    verified: payload.verified,
    message: typeof payload.message === 'string' ? payload.message : null,
    connection,
  };
}

export async function disconnectGoogleWorkspace(): Promise<GoogleDisconnection> {
  const payload = await callGoogleWorkspace('disconnect');
  const connection = parseGoogleConnection(payload.connection);
  if (
    typeof payload.providerRevoked !== 'boolean' ||
    typeof payload.message !== 'string' ||
    !connection
  ) {
    throw new Error(INVALID_RESPONSE);
  }
  return { providerRevoked: payload.providerRevoked, message: payload.message, connection };
}
