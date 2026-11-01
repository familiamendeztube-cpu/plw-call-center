import type { AgentId } from '@/features/auth/models/agent';

export type FollowupKind = 'callback' | 'email' | 'meeting';

export const FOLLOWUP_KIND_LABELS: Record<FollowupKind, string> = {
  callback: 'Llamada de regreso',
  email: 'Correo de seguimiento',
  meeting: 'Reunión o demostración',
};

export interface Followup {
  id: string;
  prospectId: string;
  agentId: AgentId;
  kind: FollowupKind;
  title: string;
  dueAt: string;
  completed: boolean;
}

export interface ScheduleFollowupInput {
  prospectId: string;
  agentId: AgentId;
  kind: FollowupKind;
  title: string;
  dueAt: string;
}
