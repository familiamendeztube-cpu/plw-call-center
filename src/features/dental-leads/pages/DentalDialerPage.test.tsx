import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { DentalDialerPage } from './DentalDialerPage';

const { controlDialer, state } = vi.hoisted(() => ({
  controlDialer: vi.fn().mockResolvedValue(undefined),
  state: { routes: [] as unknown[] },
}));

vi.mock('../services/dentalDialer', () => ({
  controlDialer,
  dentalServerAction: vi.fn(),
  confirmTransfer: vi.fn(),
  loadTranscript: vi.fn(),
}));
vi.mock('@/features/auth/context/useAuth', () => ({
  useAuth: () => ({ session: { role: 'admin', source: 'production', displayName: 'Admin' } }),
}));
vi.mock('../hooks/useDentalDialer', () => ({
  useDentalDialer: () => ({
    loading: false,
    error: '',
    reload: vi.fn(),
    routes: state.routes,
    calls: [],
    runtime: { last_tick_at: new Date().toISOString(), scheduler_ready: true, last_error: '' },
  }),
}));
vi.mock('../hooks/useDentalLeads', () => ({
  useDentalLeads: () => ({ loading: false, error: '', leads: [] }),
}));

function route(staffId: string, name: string) {
  return {
    staff_id: staffId,
    state: 'paused',
    provider_agent_id: `dedicated-${name}`,
    config_verified_at: '2026-11-10',
    transfer_verified_at: '2026-11-10',
    last_error: '',
    pilot_call_limit: null,
    pilot_baseline_count: 0,
  };
}

beforeEach(() => {
  controlDialer.mockClear();
  state.routes = [route('agent-2', 'alejandro'), route('agent-3', 'valeska')];
});

it('renders one controls region per selected agent and submits to that agent after repeated switches', async () => {
  render(
    <MemoryRouter>
      <DentalDialerPage />
    </MemoryRouter>
  );
  const select = screen.getByRole('combobox') as HTMLSelectElement;
  for (const staff of ['agent-3', 'agent-2', 'agent-3', 'agent-2']) {
    fireEvent.change(select, { target: { value: staff } });
    expect(
      screen.getByText(`Agente seleccionado: ${staff === 'agent-3' ? 'Valeska' : 'Alejandro'}`)
    ).toBeTruthy();
    const regions = screen.getAllByRole('region', { name: 'Control del marcador' });
    expect(regions).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Continuar' })).toHaveLength(1);
  }
  fireEvent.change(select, { target: { value: 'agent-3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await waitFor(() => expect(controlDialer).toHaveBeenCalledWith('agent-3', 'resume'));
  expect(controlDialer).toHaveBeenCalledTimes(1);
});
