import {
  parseAdminAgents,
  parseOfficeEnrollmentCode,
  type AdminAgent,
  type AgentProfileInput,
  type OfficeEnrollmentCode,
} from '@/features/admin/models/adminAgents';
import { callStaffFunction, INVALID_RESPONSE } from '@/integrations/supabase/callStaffFunction';
import { getSupabaseClient } from '@/integrations/supabase/client';

function callAdminActions(body: Record<string, unknown>) {
  return callStaffFunction('admin-actions', body);
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

/** The next agent-N, disabled until it has a PIN and is enabled. */
export async function createAgent(displayName: string): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('admin_create_agent', {
    p_display_name: displayName,
  });
  if (error || typeof data !== 'string')
    throw new Error(error?.message || 'No se pudo agregar el agente.');
  return data;
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
