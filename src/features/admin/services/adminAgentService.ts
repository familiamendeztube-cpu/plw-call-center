import {
  parseAdminAgents,
  parseOfficeEnrollmentCode,
  type AdminAgent,
  type AgentProfileInput,
  type OfficeEnrollmentCode,
} from '@/features/admin/models/adminAgents';
import {
  getSupabaseClient,
  supabaseAnonKeyValue,
  supabaseFunctionsUrl,
} from '@/integrations/supabase/client';

const SESSION_ENDED = 'Tu sesión venció. Ingresa de nuevo para continuar.';
const CONNECTION_FAILURE = 'No se pudo conectar. Intente de nuevo.';
const INVALID_RESPONSE = 'La respuesta del servidor no es válida. Intente de nuevo.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function callAdminActions(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await getSupabaseClient().auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error(SESSION_ENDED);

  let response: Response;
  try {
    response = await fetch(`${supabaseFunctionsUrl}/admin-actions`, {
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

export async function listAdminAgents(): Promise<AdminAgent[]> {
  const agents = parseAdminAgents(await callAdminActions({ action: 'list_agents' }));
  if (!agents) throw new Error(INVALID_RESPONSE);
  return agents;
}

export async function saveAgentProfile(staffId: string, input: AgentProfileInput): Promise<void> {
  await callAdminActions({
    action: 'update_staff',
    staffId,
    displayName: input.displayName,
    isEnabled: input.isEnabled,
    maxActiveProspects: input.maxActiveProspects,
  });
}

export async function setAgentPin(staffId: string, pin: string): Promise<void> {
  await callAdminActions({ action: 'set_secret', staffId, kind: 'pin', secret: pin });
}

export async function revokeAgentSessions(staffId: string): Promise<void> {
  await callAdminActions({ action: 'revoke_sessions', staffId });
}

export async function createOfficeEnrollmentCode(label: string): Promise<OfficeEnrollmentCode> {
  const enrollment = parseOfficeEnrollmentCode(
    await callAdminActions({ action: 'create_enrollment', label })
  );
  if (!enrollment) throw new Error(INVALID_RESPONSE);
  return enrollment;
}
