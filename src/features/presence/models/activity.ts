import type { AgentId } from '@/features/auth/models/agent';

export type ActivityKind = 'call' | 'note' | 'followup' | 'message' | 'stage_change' | 'assignment';

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  call: 'Llamada',
  note: 'Nota privada',
  followup: 'Seguimiento',
  message: 'Mensaje',
  stage_change: 'Cambio de etapa',
  assignment: 'Asignación',
};

export interface ActivityEvent {
  id: string;
  agentId: AgentId;
  kind: ActivityKind;
  summary: string;
  occurredAt: string;
}
