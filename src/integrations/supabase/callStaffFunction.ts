import {
  getSupabaseClient,
  supabaseAnonKeyValue,
  supabaseFunctionsUrl,
} from '@/integrations/supabase/client';

const SESSION_ENDED = 'Tu sesión venció. Ingresa de nuevo para continuar.';
const CONNECTION_FAILURE = 'No se pudo conectar. Intente de nuevo.';
export const INVALID_RESPONSE = 'La respuesta del servidor no es válida. Intente de nuevo.';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function callStaffFunction(
  name: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { data } = await getSupabaseClient().auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error(SESSION_ENDED);

  let response: Response;
  try {
    response = await fetch(`${supabaseFunctionsUrl}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKeyValue,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(CONNECTION_FAILURE);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : null;
    throw new Error(message ?? CONNECTION_FAILURE);
  }
  if (!isRecord(payload)) throw new Error(INVALID_RESPONSE);
  return payload;
}
