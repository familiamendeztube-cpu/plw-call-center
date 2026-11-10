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

export type IncomingDentalContext =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; call: IncomingDentalCallRow; lead: IncomingDentalLead | null };

export function isIncomingRinging(call: CallSnapshot | null): call is CallSnapshot {
  return call !== null && call.direction === 'inbound' && call.state === 'ringing';
}

export function showCompactContext(call: CallSnapshot | null): boolean {
  return call !== null && (call.state === 'active' || call.state === 'on_hold');
}

export function isPollableDentalCall(call: CallSnapshot | null): boolean {
  return (
    call !== null &&
    call.dentalCallId != null &&
    (call.state === 'ringing' || call.state === 'active' || call.state === 'on_hold')
  );
}

export function dentalContext(
  call: CallSnapshot | null,
  agentId: string | null | undefined,
  lookup: IncomingDentalLookup | null
): IncomingDentalContext {
  const callId = call?.dentalCallId ?? null;
  if (!callId || agentId == null || !lookup) return { kind: 'none' };
  if (lookup.status === 'loading') return { kind: 'loading' };
  if (lookup.status === 'unknown') return { kind: 'unavailable' };
  if (lookup.call.id !== callId || lookup.call.staff_id !== agentId) return { kind: 'unavailable' };
  return { kind: 'ready', call: lookup.call, lead: lookup.lead };
}
