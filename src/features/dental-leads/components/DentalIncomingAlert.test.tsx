import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CallSnapshot } from '@/features/telephony/models/call';
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

function renderAlert() {
  return render(
    <MemoryRouter>
      <DentalIncomingAlert />
    </MemoryRouter>
  );
}

beforeEach(() => {
  loadIncomingDentalCall.mockReset();
  telephony.answerCall.mockReset();
  telephony.hangUp.mockReset();
  auth.session = { role: 'agent', agentId: 'agent-2', displayName: 'Alejandro' };
  loadIncomingDentalCall.mockResolvedValue({
    call: {
      id: callId,
      lead_id: 'lead-1',
      staff_id: 'agent-2',
      phone: '22223333',
      state: 'started',
      transfer_status: 'requested',
      summary: 'Resumen de prueba',
    },
    lead: {
      id: 'lead-1',
      business_name: 'Clínica Demo',
      province: 'San José',
      canton: 'Escazú',
      address: 'Frente al parque',
    },
  });
});

it('shows the owned lead, phone, agent and summary and answers through the phone', async () => {
  telephony.call = ringing();
  renderAlert();
  expect(screen.getByRole('status').textContent).toContain('Cargando');
  expect(await screen.findByRole('heading', { name: 'Clínica Demo' })).toBeTruthy();
  expect(screen.getByText('+506 22223333')).toBeTruthy();
  expect(screen.getByText('Resumen de prueba')).toBeTruthy();
  screen.getByRole('button', { name: 'Contestar' }).click();
  expect(telephony.answerCall).toHaveBeenCalledTimes(1);
});

it('looks up a call only once across repeated events for the same call id', async () => {
  telephony.call = ringing();
  const { rerender } = renderAlert();
  await screen.findByRole('heading', { name: 'Clínica Demo' });
  telephony.call = ringing();
  rerender(
    <MemoryRouter>
      <DentalIncomingAlert />
    </MemoryRouter>
  );
  await waitFor(() => expect(loadIncomingDentalCall).toHaveBeenCalledTimes(1));
});

it('does not guess a lead when the header is malformed or missing', () => {
  telephony.call = ringing({ dentalCallId: null });
  renderAlert();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(loadIncomingDentalCall).not.toHaveBeenCalled();
});

it('falls back to an honest message when the call is not this agent’s', async () => {
  loadIncomingDentalCall.mockResolvedValueOnce({
    call: { id: callId, lead_id: 'lead-1', staff_id: 'agent-3', phone: '22223333', state: 'started', transfer_status: 'requested', summary: null },
    lead: null,
  });
  telephony.call = ringing();
  renderAlert();
  expect(await screen.findByText(/no está asignada a su usuario/)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Clínica Demo' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Rechazar' })).toBeTruthy();
});

it('shows an unknown state when the lookup fails instead of inventing details', async () => {
  loadIncomingDentalCall.mockRejectedValueOnce(new Error('falla'));
  telephony.call = ringing();
  renderAlert();
  expect(await screen.findByText(/No pudimos confirmar/)).toBeTruthy();
});
