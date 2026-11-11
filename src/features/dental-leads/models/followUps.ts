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
 * Negative: a goes first. Positive: b goes first. Zero: keep the current order.
 *
 * TODO(owner): choose the order. Useful fields:
 * - a.call?.created_at: when Anna called (ISO text; compare with Date.parse)
 * - a.call?.outcome: e.g. 'WHATSAPP_INFO_REQUESTED', 'CALLBACK_REQUESTED', 'VOICEMAIL'
 * - a.call?.transfer_status: 'requested' when Anna tried to pass the call to the agent
 * - a.call?.details?.callback_time: free text the dentist said ("mañana a las 10")
 */
export function compareFollowUps(a: FollowUp, b: FollowUp): number {
  void a;
  void b;
  return 0;
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
