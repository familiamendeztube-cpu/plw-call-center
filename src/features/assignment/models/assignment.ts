import type { AgentId } from '@/features/auth/models/agent';

export const ASSIGNMENT_MECHANISM_LABELS: Record<AssignmentMechanism, string> = {
  round_robin: 'Rotación automática',
  manual: 'Asignación manual',
};

export type AssignmentMechanism = 'round_robin' | 'manual';

export interface WaitingEntry {
  prospectId: string;
  queuedAt: string;
}

export interface OverdueEntry {
  conversationId: string;
  prospectId: string;
  ownerId: AgentId | null;
  lastMessageAt: string;
}

export interface AssignmentHistoryEntry {
  id: string;
  prospectId: string;
  fromOwnerId: AgentId | null;
  toOwnerId: AgentId | null;
  mechanism: AssignmentMechanism;
  reason: string | null;
  createdAt: string;
}

export interface AssignmentBoard {
  waiting: WaitingEntry[];
  overdue: OverdueEntry[];
  history: AssignmentHistoryEntry[];
}

export interface NewInquiryInput {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  businessCategory: string;
  serviceInterest: string;
  source: string;
  notes: string;
  isTest: boolean;
}

export interface ReassignInput {
  prospectId: string;
  toAgentId: AgentId;
  reason: string;
}

export const REASSIGN_REASON_MIN_LENGTH = 3;
export const REASSIGN_REASON_MAX_LENGTH = 300;

export function validateReassignReason(reason: string): string | null {
  const length = reason.trim().length;
  if (length < REASSIGN_REASON_MIN_LENGTH) {
    return `Escribe un motivo de al menos ${REASSIGN_REASON_MIN_LENGTH} caracteres.`;
  }
  if (length > REASSIGN_REASON_MAX_LENGTH) {
    return `El motivo no puede superar ${REASSIGN_REASON_MAX_LENGTH} caracteres.`;
  }
  return null;
}
