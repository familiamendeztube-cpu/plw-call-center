import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CallSnapshot, CallState } from '@/features/telephony/models/call';
import { DentalIncomingAlert } from './DentalIncomingAlert';

const { loadIncomingDentalCall, telephony, auth } = vi.hoisted(() => ({
  loadIncomingDentalCall: vi.fn(),
  telephony: { call: null as CallSnapshot | null, answerCall: vi.fn(), hangUp: vi.fn() },
  auth: { session: { role: 'agent', agentId: 'agent-2', displayName: 'Alejandro' } },
}));

vi.mock('../services/dentalDialer', () => ({ loadIncomingDentalCall }));
vi.mock('@/features/auth/context/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/features/telephony/context/telephonyContext', () => ({
  useTelephony: () => telephony,
}));

const callId = '6f1c3c2e-8b1d-4c57-9a55-2d1f0a7e9b10';
const ringing = (overrides: Partial<CallSnapshot> = {}): CallSnapshot => ({
  id: 'sip-1',
  state: 'ringing',
  direction: 'inbound',
  remoteNumber: '22223333',
  startedAt: null,
  muted: false,
  dentalCallId: callId,
  ...overrides,
});
const lead = {
  id: 'lead-1',
  business_name: 'Clínica Demo',
  province: 'San José',
  canton: 'Escazú',
  address: 'Frente al parque',
};
const dbRow = (overrides: Record<string, unknown> = {}) => ({
  id: callId,
  lead_id: 'lead-1',
  staff_id: 'agent-2',
  phone: '22223333',
  state: 'started',
  transfer_status: 'requested',
  summary: 'Resumen de prueba',
  ...overrides,
});

function renderAlert() {
  return render(
    <MemoryRouter>
      <DentalIncomingAlert />
    </MemoryRouter>
  );
}

function setCall(state: CallState, overrides: Partial<CallSnapshot> = {}) {
  telephony.call = ringing({ state, ...overrides });
}

beforeEach(() => {
  loadIncomingDentalCall.mockReset();
  telephony.answerCall.mockReset();
  telephony.hangUp.mockReset();
  telephony.call = null;
  auth.session = { role: 'agent', agentId: 'agent-2', displayName: 'Alejandro' };
  loadIncomingDentalCall.mockResolvedValue({ call: dbRow(), lead });
});

afterEach(() => {
  vi.useRealTimers();
});

it('shows the real number, the owned lead and answers through the phone', async () => {
  setCall('ringing');
  renderAlert();
  expect(screen.getByText('22223333')).toBeTruthy();
  expect(await screen.findByRole('heading', { name: 'Clínica Demo' })).toBeTruthy();
  expect(screen.getByText('Resumen de prueba')).toBeTruthy();
  screen.getByRole('button', { name: 'Contestar' }).click();
  expect(telephony.answerCall).toHaveBeenCalledTimes(1);
});

it('keeps the generic alert and its controls when there is no dental header', () => {
  setCall('ringing', { dentalCallId: null });
  renderAlert();
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(screen.getByText('22223333')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Contestar' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Rechazar' })).toBeTruthy();
  expect(loadIncomingDentalCall).not.toHaveBeenCalled();
});

it('does not expose another agent’s lead and keeps the controls', async () => {
  loadIncomingDentalCall.mockResolvedValueOnce({ call: dbRow({ staff_id: 'agent-3' }), lead });
  setCall('ringing');
  renderAlert();
  expect(await screen.findByText(/No pudimos vincular/)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Clínica Demo' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Rechazar' })).toBeTruthy();
});

it('shows an unavailable note when the lookup fails and keeps the controls', async () => {
  loadIncomingDentalCall.mockRejectedValueOnce(new Error('falla'));
  setCall('ringing');
  renderAlert();
  expect(await screen.findByText(/No pudimos vincular/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Contestar' })).toBeTruthy();
});

it('keeps a compact client panel with the lead while the call is active', async () => {
  setCall('active');
  renderAlert();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(await screen.findByRole('heading', { name: 'Clínica Demo' })).toBeTruthy();
  const link = screen.getByRole('link', { name: 'Ver llamada' });
  expect(link.getAttribute('href')).toBe(`/llamadas-dentales?call=${callId}`);
});

it('keeps the lead context when Ana completed the dental call at transfer', async () => {
  loadIncomingDentalCall.mockResolvedValue({ call: dbRow({ state: 'completed', transfer_status: 'completed' }), lead });
  setCall('active');
  renderAlert();
  expect(await screen.findByRole('heading', { name: 'Clínica Demo' })).toBeTruthy();
});

it('refreshes the correlated row while ringing so a delayed summary appears', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  loadIncomingDentalCall
    .mockResolvedValueOnce({ call: dbRow({ summary: null }), lead })
    .mockResolvedValueOnce({ call: dbRow({ summary: 'Resumen tardío' }), lead });
  setCall('ringing');
  renderAlert();
  expect(await screen.findByText('Resumen todavía no disponible.')).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(await screen.findByText('Resumen tardío')).toBeTruthy();
  expect(loadIncomingDentalCall).toHaveBeenCalledTimes(2);
});

it('looks up a call only once across repeated events for the same call id', async () => {
  setCall('ringing');
  const { rerender } = renderAlert();
  await screen.findByRole('heading', { name: 'Clínica Demo' });
  setCall('ringing');
  rerender(
    <MemoryRouter>
      <DentalIncomingAlert />
    </MemoryRouter>
  );
  await waitFor(() => expect(loadIncomingDentalCall).toHaveBeenCalledTimes(1));
});

it('shows no alert for an ended call', () => {
  setCall('ended');
  renderAlert();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(loadIncomingDentalCall).not.toHaveBeenCalled();
});
