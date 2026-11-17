import { getCostaRicaDayKey } from '@/app/dates';
import type { DentalCall } from './dentalDialer';

export type DentalResult =
  | 'interested'
  | 'asked'
  | 'not_interested'
  | 'no_answer'
  | 'bad_number'
  | 'unavailable'
  | 'failed'
  | 'no_result';

/** Columns of Anna's report, in reading order: the good news first. */
export const DENTAL_RESULT_LABELS: Record<DentalResult, string> = {
  interested: 'Interesados',
  asked: 'Pidieron llamada',
  not_interested: 'No interesados',
  no_answer: 'Buzón o no contestó',
  bad_number: 'Número malo',
  unavailable: 'Línea no disponible',
  failed: 'Fallas',
  no_result: 'Sin resultado',
};

const BY_OUTCOME: Record<string, DentalResult> = {
  APPOINTMENT_CONFIRMED: 'interested',
  APPOINTMENT_REQUESTED: 'interested',
  INTERESTED_FOLLOW_UP: 'interested',
  WHATSAPP_INFO_REQUESTED: 'interested',
  CALLBACK_REQUESTED: 'asked',
  DECISION_MAKER_UNAVAILABLE: 'asked',
  RECEPTIONIST_CONTACT: 'asked',
  NOT_INTERESTED: 'not_interested',
  DO_NOT_CALL: 'not_interested',
  WRONG_NUMBER: 'bad_number',
  NO_ANSWER: 'no_answer',
  VOICEMAIL: 'no_answer',
  TECHNICAL_FAILURE: 'failed',
};

/** What one finished call amounted to; null while it is still going. */
export function dentalResult(call: DentalCall): DentalResult | null {
  if (['reserved', 'started', 'uncertain'].includes(call.state)) return null;
  if (call.outcome && BY_OUTCOME[call.outcome]) return BY_OUTCOME[call.outcome];
  // The phone network refused the call before Anna spoke.
  if (/SIP 404/.test(call.error)) return 'bad_number';
  if (/SIP (408|480|486|503)/.test(call.error)) return 'unavailable';
  if (call.state === 'failed' || call.state === 'cancelled') return 'failed';
  return 'no_result';
}

export interface DentalDayResults {
  /** Costa Rica day, YYYY-MM-DD; 'total' for the sum row. */
  day: string;
  calls: number;
  transfers: number;
  results: Record<DentalResult, number>;
}

const empty = (day: string): DentalDayResults => ({
  day,
  calls: 0,
  transfers: 0,
  results: Object.fromEntries(Object.keys(DENTAL_RESULT_LABELS).map((key) => [key, 0])) as Record<
    DentalResult,
    number
  >,
});

/** Anna's real (not test) finished calls per day, newest day first, plus a total. */
export function dentalResultsByDay(calls: DentalCall[]): {
  days: DentalDayResults[];
  total: DentalDayResults;
} {
  const days = new Map<string, DentalDayResults>();
  const total = empty('total');
  for (const call of calls) {
    const result = call.is_test ? null : dentalResult(call);
    if (!result) continue;
    const key = getCostaRicaDayKey(new Date(call.created_at));
    const row = days.get(key) ?? empty(key);
    for (const target of [row, total]) {
      target.calls += 1;
      target.results[result] += 1;
      if (call.transfer_status === 'agent_confirmed') target.transfers += 1;
    }
    days.set(key, row);
  }
  return { days: [...days.values()].sort((a, b) => b.day.localeCompare(a.day)), total };
}
