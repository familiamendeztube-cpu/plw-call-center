import { expect, test } from 'vitest';
import { missedCalls, type PhoneRecord } from '@/features/admin/models/missedCalls';
import { dentalResultsByDay } from '@/features/dental-leads/models/dentalResults';
import type { DentalCall } from '@/features/dental-leads/models/dentalDialer';

const leg = (record: Partial<PhoneRecord>): PhoneRecord => ({
  linkedId: 'x',
  staffId: null,
  direction: 'inbound',
  number: '88881234',
  disposition: 'NO ANSWER',
  talkSeconds: 0,
  startedAt: '2026-11-16T15:00:00Z',
  ...record,
});

test('a missed call is an inbound call no leg answered, until someone calls back', () => {
  const missed = missedCalls([
    // Rang two agents, nobody answered: missed, then Alejandro called back.
    leg({ linkedId: 'a', staffId: 'agent-2' }),
    leg({ linkedId: 'a', staffId: 'agent-3', disposition: 'BUSY' }),
    leg({
      linkedId: 'b',
      direction: 'outbound',
      staffId: 'agent-2',
      number: '+506 8888-1234',
      startedAt: '2026-11-16T16:00:00Z',
    }),
    // The AI receptionist answered this one: not missed.
    leg({ linkedId: 'c', number: '22223333', startedAt: '2026-11-16T17:00:00Z' }),
    leg({
      linkedId: 'c',
      number: '22223333',
      disposition: 'ANSWERED',
      talkSeconds: 40,
      startedAt: '2026-11-16T17:00:00Z',
    }),
    // Nobody answered and nobody called back yet.
    leg({ linkedId: 'd', number: '70001111', startedAt: '2026-11-16T18:00:00Z' }),
  ]);

  expect(missed).toEqual([
    { linkedId: 'd', number: '70001111', at: '2026-11-16T18:00:00Z', returned: null },
    {
      linkedId: 'a',
      number: '88881234',
      at: '2026-11-16T15:00:00Z',
      returned: { at: '2026-11-16T16:00:00Z', staffId: 'agent-2' },
    },
  ]);
});

const call = (fields: Partial<DentalCall>): DentalCall => ({
  id: crypto.randomUUID(),
  lead_id: 'lead',
  staff_id: 'agent-2',
  phone: '22223333',
  is_test: false,
  state: 'completed',
  transfer_status: 'none',
  created_at: '2026-11-12T15:00:00Z',
  finished_at: null,
  error: '',
  ...fields,
});

test("Anna's results add up per Costa Rica day, without tests or calls still going", () => {
  const { days, total } = dentalResultsByDay([
    call({ outcome: 'INTERESTED_FOLLOW_UP', transfer_status: 'agent_confirmed' }),
    call({ outcome: 'VOICEMAIL' }),
    call({ state: 'failed', error: 'Rechazada: SIP 404 Not Found' }),
    call({ state: 'failed', error: 'SIP 480 Temporarily Unavailable' }),
    // 23:30 on the 12th in Costa Rica is already the 13th in UTC.
    call({ outcome: 'CALLBACK_REQUESTED', created_at: '2026-11-13T05:30:00Z' }),
    call({ outcome: 'NOT_INTERESTED', created_at: '2026-11-13T15:00:00Z' }),
    call({ is_test: true, outcome: 'INTERESTED_FOLLOW_UP' }),
    call({ state: 'started' }),
  ]);

  expect(days.map((day) => [day.day, day.calls])).toEqual([
    ['2026-11-13', 1],
    ['2026-11-12', 5],
  ]);
  expect(total.calls).toBe(6);
  expect(total.transfers).toBe(1);
  expect(total.results).toMatchObject({
    interested: 1,
    asked: 1,
    not_interested: 1,
    no_answer: 1,
    bad_number: 1,
    unavailable: 1,
  });
});
