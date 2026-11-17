import { lastDigits } from '@/features/telephony/models/call';

/** One leg of a call as the phone server recorded it (asterisk_calls). */
export interface PhoneRecord {
  linkedId: string;
  staffId: string | null;
  direction: 'inbound' | 'outbound';
  number: string;
  disposition: string;
  talkSeconds: number;
  startedAt: string;
}

export interface MissedCall {
  linkedId: string;
  number: string;
  at: string;
  /** The first later call with this number that connected, or an agent's call out to it. */
  returned: { at: string; staffId: string | null } | null;
}

/**
 * Inbound calls nobody answered: no agent and not the AI receptionist (her answer is a leg too,
 * and those callers are in Solicitudes IA). Newest first.
 */
export function missedCalls(records: PhoneRecord[]): MissedCall[] {
  const calls = new Map<string, PhoneRecord[]>();
  for (const record of records) {
    const key = `${record.direction}:${record.linkedId}`;
    calls.set(key, [...(calls.get(key) ?? []), record]);
  }

  const missed: MissedCall[] = [];
  for (const legs of calls.values()) {
    const [first] = legs;
    if (first.direction !== 'inbound' || legs.some((leg) => leg.disposition === 'ANSWERED'))
      continue;
    const digits = lastDigits(first.number);
    const later = records
      .filter(
        (record) =>
          lastDigits(record.number) === digits &&
          record.startedAt > first.startedAt &&
          (record.direction === 'outbound' || record.disposition === 'ANSWERED')
      )
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
    missed.push({
      linkedId: first.linkedId,
      number: first.number,
      at: first.startedAt,
      returned: later ? { at: later.startedAt, staffId: later.staffId } : null,
    });
  }
  return missed.sort((a, b) => b.at.localeCompare(a.at));
}
