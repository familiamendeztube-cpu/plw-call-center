import { toCostaRicaNumber, type CallSnapshot } from '@/features/telephony/models/call';
import type { DentalTranscript } from './dentalDialer';

export interface IncomingDentalCallRow {
  id: string;
  lead_id: string;
  staff_id: string;
  phone: string;
  state: string;
  transfer_status: string;
  summary: string | null;
  /** Synced from ElevenLabs every few seconds, so it is there before the post-call summary. */
  transcript?: DentalTranscript['transcript'] | null;
  details?: Record<string, string> | null;
}

export interface IncomingDentalLead {
  id: string;
  business_name: string;
  contact_name?: string | null;
  province: string | null;
  canton: string | null;
  address: string | null;
}

export type IncomingDentalLookup =
  | { status: 'loading' }
  | { status: 'unknown' }
  | { status: 'none' }
  | { status: 'ready'; call: IncomingDentalCallRow; lead: IncomingDentalLead | null };

export type IncomingDentalContext =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; call: IncomingDentalCallRow; lead: IncomingDentalLead | null };

/**
 * How a live call is linked to Anna's dental call: her SIP header when it arrives, otherwise
 * the dentist's number. Asterisk carries out her transfer and drops the header, so on a real
 * transfer only the dentist's 8 digits (set by plw-dental-ring) reach the agent.
 */
export interface DentalCallMatch {
  id: string | null;
  phone: string | null;
}

export function isIncomingRinging(call: CallSnapshot | null): call is CallSnapshot {
  return call !== null && call.direction === 'inbound' && call.state === 'ringing';
}

export function showCompactContext(call: CallSnapshot | null): boolean {
  return call !== null && (call.state === 'active' || call.state === 'on_hold');
}

/** What to look up for a ringing, active or held call, or null when there is nothing to. */
export function dentalMatch(call: CallSnapshot | null): DentalCallMatch | null {
  if (!call || !['ringing', 'active', 'on_hold'].includes(call.state)) return null;
  if (call.dentalCallId) return { id: call.dentalCallId, phone: null };
  const phone = call.direction === 'inbound' ? toCostaRicaNumber(call.remoteNumber) : null;
  return phone ? { id: null, phone } : null;
}

export function dentalContext(
  call: CallSnapshot | null,
  agentId: string | null | undefined,
  lookup: IncomingDentalLookup | null
): IncomingDentalContext {
  const match = dentalMatch(call);
  if (!match || agentId == null || !lookup) return { kind: 'none' };
  if (
    lookup.status === 'ready' &&
    lookup.call.staff_id === agentId &&
    (!match.id || lookup.call.id === match.id)
  )
    return { kind: 'ready', call: lookup.call, lead: lookup.lead };
  // Matched only by number, so it is most likely an ordinary call: show nothing extra.
  if (!match.id) return { kind: 'none' };
  return lookup.status === 'loading' ? { kind: 'loading' } : { kind: 'unavailable' };
}
