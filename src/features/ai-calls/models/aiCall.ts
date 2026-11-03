export type AiCallStatus = 'pending' | 'in_progress' | 'completed' | 'canceled';

export const AI_CALL_STATUS_LABELS: Record<AiCallStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En proceso',
  completed: 'Completado',
  canceled: 'Cancelado',
};

export const AI_CALL_STATUSES = Object.keys(AI_CALL_STATUS_LABELS) as AiCallStatus[];

export const CONTACT_LABELS = { phone: 'Llamada', whatsapp: 'WhatsApp' } as const;

export interface AiCall {
  id: string;
  conversationId: string;
  prospectId: string | null;
  callerPhone: string | null;
  callbackPhone: string | null;
  customerName: string | null;
  businessName: string | null;
  reason: string | null;
  preferredContact: keyof typeof CONTACT_LABELS | null;
  preferredTime: string | null;
  consent: boolean | null;
  summary: string | null;
  callStartedAt: string;
  callDurationSeconds: number | null;
  status: AiCallStatus;
  statusBy: string | null;
  statusAt: string | null;
  prospect: { ownerId: string | null } | null;
}

// PostgREST aliases return the rows already shaped as AiCall.
export const AI_CALL_COLUMNS = [
  'id',
  'conversationId:conversation_id',
  'prospectId:prospect_id',
  'callerPhone:caller_phone',
  'callbackPhone:callback_phone',
  'customerName:customer_name',
  'businessName:business_name',
  'reason',
  'preferredContact:preferred_contact',
  'preferredTime:preferred_time',
  'consent',
  'summary',
  'callStartedAt:call_started_at',
  'callDurationSeconds:call_duration_seconds',
  'status',
  'statusBy:status_by',
  'statusAt:status_at',
  'prospect:prospects(ownerId:owner_id)',
].join(',');

/** The number the customer asked to be called on, else the caller ID. */
export function contactNumber(call: AiCall): string | null {
  return call.callbackPhone ?? call.callerPhone;
}
