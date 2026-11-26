import { expect, test } from 'vitest';
import { missedCalls, type PhoneRecord } from '@/features/admin/models/missedCalls';

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
