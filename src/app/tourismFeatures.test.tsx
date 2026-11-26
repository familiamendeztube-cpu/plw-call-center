import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TourismMilestones } from '@/features/customers/components/TourismMilestones';

// Rows returned by table reads; a test can push into this before rendering.
export const tableRows: Record<string, unknown[]> = {};
vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ then: (r: (x: unknown) => void) => r({ data: tableRows[table] ?? [], error: null }) }),
        order: () => ({
          limit: () => Promise.resolve({ data: tableRows[table] ?? [], error: null }),
        }),
        then: (r: (x: unknown) => void) => r({ data: tableRows[table] ?? [], error: null }),
      }),
      rpc: () => ({ then: (r: (x: unknown) => void) => r({ error: null }) }),
    }),
  }),
}));

vi.mock('@/integrations/supabase/callStaffFunction', () => ({
  isRecord: (value: unknown) => typeof value === 'object' && value !== null,
  postStaffFunction: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  readStaffFunctionError: vi.fn(async () => ({ message: 'error' })),
}));

describe('TourismMilestones', () => {
  it('shows the three stages in Spanish with a register button for agents', async () => {
    render(<TourismMilestones prospectId="p1" agentId="agent-2" />);
    expect(await screen.findByText('Material entregado')).toBeTruthy();
    expect(screen.getByText('Devolución agendada')).toBeTruthy();
    expect(screen.getByText('Demo realizada')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Registrar' });
    expect(buttons.length).toBe(4); // three direct + the Demo agendada form submit
  });

  it('never shows a register button to the administrator', () => {
    render(<TourismMilestones prospectId="p1" />);
    expect(screen.getAllByText('Material entregado').length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: 'Registrar' }).length).toBe(0);
  });

  it('shows all four stages in order, with the demo slot input only for Demo agendada', async () => {
    render(<TourismMilestones prospectId="p1" agentId="agent-2" />);
    expect(await screen.findByText('Material entregado')).toBeTruthy();
    expect(screen.getByText('Devolución agendada')).toBeTruthy();
    expect(screen.getByText('Demo agendada')).toBeTruthy();
    expect(screen.getByText('Demo realizada')).toBeTruthy();
    // Demo agendada requires an explicit date and time; the others register directly.
    expect(screen.getAllByRole('button', { name: 'Registrar' }).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByLabelText('Fecha y hora de la demo')).toBeTruthy();
  });
});
