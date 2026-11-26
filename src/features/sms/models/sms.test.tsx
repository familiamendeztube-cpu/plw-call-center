import { describe, expect, it } from 'vitest';
import { toSmsThread, type SmsRow } from '@/features/sms/models/sms';

const row = (id: string, direction: 'in' | 'out', at: string, extra: Partial<SmsRow> = {}): SmsRow => ({
  id,
  direction,
  body: `texto ${id}`,
  status: direction === 'in' ? 'received' : 'sent',
  is_stop: false,
  created_at: at,
  ...extra,
});

describe('toSmsThread', () => {
  it('locks the reply box until the customer texts first', () => {
    expect(toSmsThread('p1', [])).toEqual({ messages: [], texted: false, stopped: false });
  });

  it('shows the texts oldest first, customer and agent, with undelivered ones marked', () => {
    const thread = toSmsThread('p1', [
      row('b', 'out', '2026-11-26T22:01:00Z', { status: 'failed' }),
      row('a', 'in', '2026-11-26T22:00:00Z'),
    ]);
    expect(thread.messages.map((m) => [m.id, m.author, m.failed])).toEqual([
      ['a', 'customer', false],
      ['b', 'agent', true],
    ]);
    expect(thread.texted).toBe(true);
  });

  it('a STOP closes the number until the customer writes again', () => {
    const stop = row('s', 'in', '2026-11-26T22:02:00Z', { is_stop: true });
    expect(toSmsThread('p1', [row('a', 'in', '2026-11-26T22:00:00Z'), stop]).stopped).toBe(true);
    const again = row('h', 'in', '2026-11-26T22:03:00Z');
    expect(toSmsThread('p1', [row('a', 'in', '2026-11-26T22:00:00Z'), stop, again]).stopped).toBe(false);
  });
});
