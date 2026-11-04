import type { AgentId } from '@/features/auth/models/agent';

export const SALES_STAGES = [
  'new',
  'contacted',
  'demo_scheduled',
  'proposal_sent',
  'follow_up',
  'won',
  'lost',
] as const;

export type SalesStage = (typeof SALES_STAGES)[number];

export const SALES_STAGE_LABELS: Record<SalesStage, string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  demo_scheduled: 'Demo agendada',
  proposal_sent: 'Propuesta enviada',
  follow_up: 'Seguimiento',
  won: 'Ganado',
  lost: 'Perdido',
};

export const PAYMENT_STATUSES = ['not_recorded', 'pending', 'paid'] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  not_recorded: 'Sin registrar',
  pending: 'Pendiente',
  paid: 'Pagado',
};

export interface Prospect {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  businessCategory: string;
  serviceInterest: string;
  /** How the inquiry arrived: 'email', 'ai_call', or free text for manual entries. */
  source: string;
  assignedAgentId: AgentId | null;
  stage: SalesStage;
  paymentStatus: PaymentStatus;
  nextAction: string;
  nextFollowUpAt: string | null;
  createdAt: string;
}
