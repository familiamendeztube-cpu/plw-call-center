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

/** A FormData body is sent as a file upload; anything else as JSON. */
export async function postStaffFunction(
  name: string,
  body: Record<string, unknown> | FormData
): Promise<Response> {
  const { data } = await getSupabaseClient().auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error(SESSION_ENDED);
  const upload = body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(`${supabaseFunctionsUrl}/${name}`, {
      method: 'POST',
      headers: {
        // The browser sets the multipart Content-Type, with its boundary, for an upload.
        ...(upload ? {} : { 'Content-Type': 'application/json' }),
        apikey: supabaseAnonKeyValue,
        Authorization: `Bearer ${accessToken}`,
      },
      body: upload ? body : JSON.stringify(body),
    });
  } catch {
    throw new Error(CONNECTION_FAILURE);
  }
  return response;
}

export async function readStaffFunctionError(response: Response): Promise<Error> {
  const payload: unknown = await response.json().catch(() => null);
  const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : null;
  return new Error(message ?? CONNECTION_FAILURE);
}

export async function callStaffFunction(
  name: string,
  body: Record<string, unknown> | FormData
): Promise<Record<string, unknown>> {
  const response = await postStaffFunction(name, body);
  if (!response.ok) throw await readStaffFunctionError(response);
  const payload: unknown = await response.json().catch(() => null);
  if (!isRecord(payload)) throw new Error(INVALID_RESPONSE);
  return payload;
}
