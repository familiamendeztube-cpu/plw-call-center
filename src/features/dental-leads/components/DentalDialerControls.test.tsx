import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DentalDialerControls } from './DentalDialerControls';
import { dialerReady, type DentalDialer } from '../models/dentalDialer';
const { controlDialer, startNextBatch } = vi.hoisted(() => ({
  controlDialer: vi.fn().mockResolvedValue(undefined),
  startNextBatch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/dentalDialer', () => ({
  controlDialer,
  startNextBatch,
  dentalServerAction: vi.fn(),
}));
const route: DentalDialer = {
  staff_id: 'agent-2',
  state: 'paused',
  provider_agent_id: 'dedicated',
  config_verified_at: '2026-11-10',
  transfer_verified_at: '2026-11-10',
  last_error: '',
};
const runtime = { last_tick_at: new Date().toISOString(), scheduler_ready: true, last_error: '' };
it('missing transfer test, missing provider and stale/future heartbeat block activation', () => {
  expect(dialerReady(route, runtime)).toBe(true);
  expect(dialerReady({ ...route, provider_agent_id: null }, runtime)).toBe(false);
  expect(dialerReady({ ...route, transfer_verified_at: null }, runtime)).toBe(false);
  for (const delta of [-180000, 180000])
    expect(
      dialerReady(route, { ...runtime, last_tick_at: new Date(Date.now() + delta).toISOString() })
    ).toBe(false);
  render(
    <DentalDialerControls
      route={{ ...route, transfer_verified_at: null }}
      runtime={runtime}
      reload={vi.fn()}
    />
  );
  expect((screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement).disabled).toBe(
    true
  );
});
it('resume applies only to the selected agent', async () => {
  const reload = vi.fn();
  render(<DentalDialerControls route={route} runtime={runtime} reload={reload} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await waitFor(() => expect(controlDialer).toHaveBeenCalledWith('agent-2', 'resume'));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('status').textContent).toContain('Acción guardada');
});

it('only a bounded pilot can start without transfer verification, and a used-up batch starts the next', async () => {
  const pending = {
    ...route,
    state: 'stopped' as const,
    transfer_verified_at: null,
    pilot_call_limit: 20,
  };
  expect(dialerReady(pending, runtime)).toBe(true);
  expect(dialerReady({ ...pending, pilot_call_limit: 21 }, runtime)).toBe(false);
  expect(dialerReady({ ...pending, config_verified_at: null }, runtime)).toBe(false);
  expect(dialerReady(pending, { ...runtime, scheduler_ready: false })).toBe(false);
  const { rerender } = render(
    <DentalDialerControls route={pending} runtime={runtime} reload={vi.fn()} />
  );
  expect(
    (screen.getByRole('button', { name: 'Activar tanda de 20' }) as HTMLButtonElement).disabled
  ).toBe(false);
  expect(screen.getByText(/Transferencia todavía no comprobada/)).toBeTruthy();
  rerender(
    <DentalDialerControls
      route={{ ...pending, state: 'paused' }}
      runtime={runtime}
      reload={vi.fn()}
      pilotAttempts={20}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Iniciar siguiente tanda de 20' }));
  await waitFor(() => expect(startNextBatch).toHaveBeenCalledWith('agent-2'));
  expect(controlDialer).not.toHaveBeenCalledWith('agent-2', 'resume');
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('Nueva tanda de 20 iniciada')
  );
});
