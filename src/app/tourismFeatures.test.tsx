import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TourismMilestones } from '@/features/customers/components/TourismMilestones';
import { TourismDialerCard } from '@/features/ai-outbound/components/TourismDialerCard';
import type { TourismPromise, TourismAlert } from '@/features/ai-outbound/services/tourismPromises';
import type { TourismRuntime, TourismCall } from '@/features/ai-outbound/components/TourismDialerCard';

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

vi.mock('@/features/ai-outbound/services/outboundCampaigns', () => ({
  listDoNotCallPhones: async () => [],
  listCampaigns: async () => [],
  createCampaign: vi.fn(),
  listCampaignAgentIds: async () => [],
  setCampaignAgent: vi.fn(),
  importLeads: vi.fn(),
}));

const RUNTIME: TourismRuntime = {
  scheduler_ready: true,
  paused: true,
  last_tick_at: '2026-11-23T14:00:00Z',
  last_error: '',
  provider_agent_id: 'tourism_agent',
  config_verified_at: '2026-11-23T12:00:00Z',
  transfer_uri: 'sip:agent-2@phone.example.com',
  dialed_today: 3,
  daily_cap: 100,
};

const CALLS: TourismCall[] = [
  {
    id: 'call-1',
    created_at: '2026-11-20T20:00:05Z',
    phone: '26720026',
    state: 'failed',
    outcome: null,
    summary: '',
    error: 'El proveedor rechazó la llamada (SIP 403).',
    is_test: false,
    lead: { business_name: 'Villa del Sueño' },
  },
];

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

describe('TourismDialerCard alert and promises', () => {
  const ALERT: TourismAlert = {
    id: 'alert-1',
    reason: 'Pausa automática: dos llamadas seguidas fueron rechazadas (SIP 403).',
    evidence: {
      calls: [
        { phone: '26720026', business: 'Villa del Sueño', at: '2026-11-20T20:00:05Z', error: 'SIP 403' },
      ],
    },
    created_at: '2026-11-20T20:00:10Z',
    cleared_at: null,
  };

  const FAILED_PROMISE: TourismPromise = {
    id: 'cb-1',
    phone: '26720026',
    scheduled_for: '2026-11-20T20:00:00Z',
    promised_at: '2026-11-20T18:30:00Z',
    status: 'failed',
    fail_reason: 'El proveedor rechazó la llamada (SIP 403).',
    resolved_at: null,
    business: 'Villa del Sueño',
    owner: 'agent-2',
  };

  it('shows a persistent alert with evidence business, phone and error', () => {
    render(
      <TourismDialerCard
        runtime={RUNTIME}
        runtimeError={null}
        calls={CALLS}
        onChanged={() => {}}
        alerts={[ALERT]}
        onRestart={async () => {}}
      />
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(within(alert).getByText(/Villa del Sueño/)).toBeTruthy();
    expect(within(alert).getByText(/26720026/)).toBeTruthy();
    expect(within(alert).getAllByText(/SIP 403/).length).toBeGreaterThan(0);
    // A single 2:00pm-style clock failure must never render the raw error as a time.
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it('lists failed promises first with the promised time and failure reason', () => {
    render(
      <TourismDialerCard
        runtime={RUNTIME}
        runtimeError={null}
        calls={CALLS}
        onChanged={() => {}}
        promises={[FAILED_PROMISE]}
        onResolve={async () => {}}
        onReschedule={async () => {}}
      />
    );
    expect(screen.getByText('Devoluciones prometidas')).toBeTruthy();
    expect(screen.getByText('Incumplida')).toBeTruthy();
    const promisesSection = screen
      .getByText('Devoluciones prometidas')
      .closest('div') as HTMLElement;
    expect(within(promisesSection).getByText(/El proveedor rechazó la llamada/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resolver' })).toBeTruthy();
  });

  it('the admin summary shows the Demo agendada count between the other stages', async () => {
    const { TourismMilestoneSummary } = await import('@/features/admin/components/TourismMilestoneSummary');
    tableRows['tourism_milestones'] = [
      { milestone: 'devolucion_agendada', due_at: null, created_at: '2026-11-20T18:30:00Z', prospect: { business_name: 'Villa del Sueño' } },
      { milestone: 'demo_agendada', due_at: '2026-11-27T20:00:00Z', created_at: '2026-11-23T14:00:00Z', prospect: { business_name: 'Villa del Sueño' } },
    ];
    const user = userEvent.setup();
    render(<TourismMilestoneSummary />);
    const demoButton = await screen.findByRole('button', { name: 'Demo agendada: 1' });
    expect(screen.getByRole('button', { name: 'Devolución agendada: 1' })).toBeTruthy();
    // Completed demos count separately; an agendada demo is not a realizada one.
    expect(screen.queryByRole('button', { name: 'Demo realizada: 0' })).toBeNull();
    await user.click(demoButton);
    expect(screen.getByText(/Villa del Sueño/)).toBeTruthy();
    expect(screen.getByText(/hora de Costa Rica/)).toBeTruthy();
  });

  it('shows no alert section when every alert is cleared', () => {
    render(
      <TourismDialerCard
        runtime={RUNTIME}
        runtimeError={null}
        calls={[]}
        onChanged={() => {}}
        alerts={[{ ...ALERT, cleared_at: '2026-11-23T15:00:00Z' }]}
        onRestart={async () => {}}
      />
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
