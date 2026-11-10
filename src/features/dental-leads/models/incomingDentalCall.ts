import type { CallSnapshot } from '@/features/telephony/models/call';

export interface IncomingDentalCallRow {
  id: string;
  lead_id: string;
  staff_id: string;
  phone: string;
  state: string;
  transfer_status: string;
  summary: string | null;
}

export interface IncomingDentalLead {
  id: string;
  business_name: string;
  province: string | null;
  canton: string | null;
  address: string | null;
}

export type IncomingDentalLookup =
  | { status: 'loading' }
  | { status: 'unknown' }
  | { status: 'ready'; call: IncomingDentalCallRow; lead: IncomingDentalLead | null };

export type IncomingDentalView =
  | { kind: 'hidden' }
  | { kind: 'loading'; callId: string }
  | { kind: 'unknown'; callId: string; reason: string }
  | { kind: 'ready'; callId: string; call: IncomingDentalCallRow; lead: IncomingDentalLead | null };

const OPEN_CALL_STATES = ['reserved', 'started', 'uncertain'];

export function incomingDentalView(
  call: CallSnapshot | null,
  agentId: string | null | undefined,
  lookup: IncomingDentalLookup
): IncomingDentalView {
  const callId = call?.dentalCallId;
  if (!call || !callId || agentId == null) return { kind: 'hidden' };
  if (call.direction !== 'inbound' || call.state !== 'ringing') return { kind: 'hidden' };
  if (lookup.status === 'loading') return { kind: 'loading', callId };
  if (lookup.status === 'unknown') {
    return {
      kind: 'unknown',
      callId,
      reason: 'No pudimos confirmar a qué dentista corresponde esta llamada.',
    };
  }
  if (lookup.call.id !== callId || lookup.call.staff_id !== agentId) {
    return {
      kind: 'unknown',
      callId,
      reason: 'Esta llamada no está asignada a su usuario. No la conteste desde esta pantalla.',
    };
  }
  if (!OPEN_CALL_STATES.includes(lookup.call.state)) {
    return {
      kind: 'unknown',
      callId,
      reason: 'Esta llamada dental ya no está activa en el marcador.',
    };
  }
  return { kind: 'ready', callId, call: lookup.call, lead: lookup.lead };
}
