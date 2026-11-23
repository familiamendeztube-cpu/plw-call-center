import { describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({ order: [] as unknown[][], rpc: null as null | Record<string, unknown> }));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => {
    const query = {
      select: () => query,
      in: () => query,
      order: (...args: unknown[]) => (sent.order.push(args), query),
      limit: async () => ({ data: [], error: null }),
    };
    return {
      from: () => query,
      rpc: async (_name: string, args: Record<string, unknown>) => ((sent.rpc = args), { error: null }),
    };
  },
}));

import { listTourismPromises, rescheduleTourismPromise } from '@/features/ai-outbound/services/tourismPromises';

describe('tourism promises', () => {
  it('lists missed promises above pending ones', async () => {
    await listTourismPromises();
    // 'failed' sorts before 'pending', so the status order must be ascending.
    expect(sent.order[0]).toEqual(['status', { ascending: true }]);
  });

  it('reschedules at the Costa Rica time the agent typed, not UTC', async () => {
    await rescheduleTourismPromise('cb-1', '2026-11-24T10:00', '');
    expect(sent.rpc?.p_new_slot).toBe('2026-11-24T16:00:00.000Z');
  });
});
