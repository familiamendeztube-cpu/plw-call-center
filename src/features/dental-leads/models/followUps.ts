import { CALL_OUTCOME, type DentalCall } from './dentalDialer';
import type { DentalLead } from './dentalLead';

/** A dentist the agent has to act on, with Anna's latest call to that dentist. */
export interface FollowUp {
  lead: DentalLead;
  call?: DentalCall;
}

/** Anna's newest real call per dentist. The server returns calls newest first. */
export function latestCallByLead(calls: DentalCall[]): Map<string, DentalCall> {
  const latest = new Map<string, DentalCall>();
  for (const call of calls)
    if (call.lead_id && !call.is_test && !latest.has(call.lead_id)) latest.set(call.lead_id, call);
  return latest;
}

/** One line under the dentist: what Anna got, who she spoke with, and when to call or visit. */
export function followUpNote(call: DentalCall | undefined): string {
  if (!call?.outcome) return '';
  const d = call.details ?? {};
  const visit = [d.appointment_date, d.appointment_time].filter(Boolean).join(' ');
  return [
    `Anna: ${CALL_OUTCOME[call.outcome] ?? call.outcome}`,
    d.contact_name && `Habló con ${d.contact_name}${d.contact_role ? ` (${d.contact_role})` : ''}`,
    d.callback_time ? `Llamar: ${d.callback_time}` : visit && `Visita: ${visit}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Which dentist the agent sees first in "Interesados" and in "Volver a llamar".
 * Negative: a goes first. Positive: b goes first.
 *
 * Newest Anna call first, the same order as the call history, so the dentist she just spoke
 * with is on top. Leads come from the server in id order, which is effectively random.
 * Other useful fields if the owner wants a different order: a.call?.outcome,
 * a.call?.transfer_status, a.call?.details?.callback_time.
 */
export function compareFollowUps(a: FollowUp, b: FollowUp): number {
  const called = (f: FollowUp) => (f.call ? Date.parse(f.call.created_at) : 0);
  return called(b) - called(a);
}

/** The agent's own dentists Anna marked Interesado or Volver a llamar, in the chosen order. */
export function followUps(leads: DentalLead[], calls: DentalCall[]) {
  const latest = latestCallByLead(calls);
  const pick = (status: DentalLead['status']) =>
    leads
      .filter((lead) => lead.status === status)
      .map((lead) => ({ lead, call: latest.get(lead.id) }))
      .sort(compareFollowUps);
  return { interested: pick('interested'), callback: pick('callback') };
}
