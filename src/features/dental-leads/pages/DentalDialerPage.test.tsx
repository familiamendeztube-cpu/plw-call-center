import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { DentalDialerPage } from './DentalDialerPage';

const ADMIN = { role: 'admin', source: 'production', displayName: 'Admin' };
const ALEJANDRO = {
  role: 'agent',
  source: 'production',
  agentId: 'agent-2',
  displayName: 'Alejandro',
};

const { controlDialer, state } = vi.hoisted(() => ({
  controlDialer: vi.fn().mockResolvedValue(undefined),
  state: {
    routes: [] as unknown[],
    calls: [] as unknown[],
    leads: [] as unknown[],
    session: {} as Record<string, string>,
  },
}));

vi.mock('../services/dentalDialer', () => ({
  controlDialer,
  dentalServerAction: vi.fn(),
  confirmTransfer: vi.fn(),
  loadTranscript: vi.fn(),
}));
vi.mock('@/features/auth/context/useAuth', () => ({
  useAuth: () => ({ session: state.session }),
}));
vi.mock('@/features/telephony/context/telephonyContext', () => ({
  useTelephony: () => ({ changeDialNumber: vi.fn() }),
}));
vi.mock('../hooks/useDentalDialer', () => ({
  useDentalDialer: () => ({
    loading: false,
    error: '',
    reload: vi.fn(),
    routes: state.routes,
    calls: state.calls,
    runtime: { last_tick_at: new Date().toISOString(), scheduler_ready: true, last_error: '' },
  }),
}));
vi.mock('../hooks/useDentalLeads', () => ({
  useDentalLeads: () => ({ loading: false, error: '', leads: state.leads, reload: vi.fn() }),
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

function lead(id: string, name: string, status: string) {
  return {
    id,
    campaign_id: 'campaign',
    phone: '22221100',
    business_name: name,
    contact_name: '',
    province: 'San José',
    canton: 'Escazú',
    address: '',
    source_url: 'https://example.org',
    source_name: 'Fuente',
    source_checked_at: '2026-11-10',
    verification: 'directory',
    owner_staff_id: 'agent-2',
    status,
    notes: '',
    updated_at: '2026-11-11',
  };
}

function call(id: string, leadId: string | null, extra: Record<string, unknown>) {
  return {
    id,
    lead_id: leadId,
    staff_id: 'agent-2',
    phone: '22221100',
    is_test: false,
    state: 'completed',
    transfer_status: 'none',
    created_at: '2026-11-11T21:30:00Z',
    finished_at: '2026-11-11T21:33:00Z',
    error: '',
    outcome: null,
    details: {},
    conversation_id: null,
    ...extra,
  };
}

beforeEach(() => {
  controlDialer.mockClear();
  state.session = ADMIN;
  state.routes = [route('agent-2', 'alejandro'), route('agent-3', 'valeska')];
  state.calls = [];
  state.leads = [];
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

it('an agent sees who to contact and their calls, never the dialer controls or counters', () => {
  state.session = ALEJANDRO;
  state.leads = [
    lead('lead-whatsapp', 'Clínica Sonrisa', 'interested'),
    lead('lead-voicemail', 'Clínica Norte', 'callback'),
    lead('lead-asked-old', 'Clínica Este', 'callback'),
    lead('lead-asked-new', 'Clínica Oeste', 'callback'),
    lead('lead-pending', 'Clínica Sur', 'pending'),
  ];
  state.calls = [
    call('call-whatsapp', 'lead-whatsapp', {
      outcome: 'WHATSAPP_INFO_REQUESTED',
      conversation_id: 'conv_1',
      details: { contact_name: 'Dra. Solís', callback_time: 'mañana a las 10' },
    }),
    call('call-voicemail', 'lead-voicemail', { outcome: 'VOICEMAIL' }),
    call('call-asked-old', 'lead-asked-old', { outcome: 'CALLBACK_REQUESTED', created_at: '2026-11-11T15:00:00Z' }),
    call('call-asked-new', 'lead-asked-new', { outcome: 'DECISION_MAKER_UNAVAILABLE', created_at: '2026-11-12T15:00:00Z' }),
    call('call-404', 'lead-pending', { state: 'failed', error: 'SIP 404' }),
  ];
  render(
    <MemoryRouter>
      <DentalDialerPage />
    </MemoryRouter>
  );

  for (const adminOnly of ['En pausa', 'Intentos', 'Llamadas activas', /Agente seleccionado/])
    expect(screen.queryByText(adminOnly)).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Control del marcador' })).toBeNull();

  const interested = screen.getByRole('region', { name: 'Interesados' });
  expect(within(interested).getByText('Clínica Sonrisa')).toBeTruthy();
  expect(
    within(interested).getByText(
      'Anna: Pidió información por WhatsApp · Habló con Dra. Solís · Llamar: mañana a las 10'
    )
  ).toBeTruthy();
  // People who asked for a call aren't buried among voicemails, and the newest call comes first.
  const asked = screen.getByRole('region', { name: 'Pidieron que los llamen' });
  expect(within(asked).getAllByRole('heading').map((h) => h.textContent)).toEqual([
    'Pidieron que los llamen (2)',
    'Clínica Oeste',
    'Clínica Este',
  ]);
  const callback = screen.getByRole('region', { name: 'Volver a llamar' });
  expect(within(callback).getByText('Clínica Norte')).toBeTruthy();
  expect(within(callback).queryByText('Clínica Este')).toBeNull();
  expect(screen.queryByText('Clínica Sur')).toBeNull();

  // Only the call that reached ElevenLabs has a transcript and a recording.
  expect(screen.getAllByRole('button', { name: 'Ver transcripción' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Escuchar la llamada' })).toHaveLength(1);
});
