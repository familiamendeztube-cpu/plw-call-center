import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { ServicesContext } from '@/app/ServicesContext';
import { createDemoServices } from '@/demo/createDemoServices';
import { AuthContext, type AuthContextValue } from '@/features/auth/context/useAuth';
import type { Session } from '@/features/auth/models/session';
import { AgentProspectsProvider } from '@/features/leads/context/AgentProspectsProvider';
import { CallWrapUp } from '@/features/telephony/components/CallWrapUp';
import { TelephonyProvider } from '@/features/telephony/context/TelephonyProvider';
import type { CallSnapshot } from '@/features/telephony/models/call';
import type {
  TelephonyConnector,
  TelephonyConnectorEvent,
} from '@/integrations/telephony/telephonyContract';

const AGENT_1: Session = { role: 'agent', source: 'demo', agentId: 'agent-1', displayName: 'Uno' };

function fakePhone() {
  const listeners = new Set<(event: TelephonyConnectorEvent) => void>();
  const ok = async () => ({ ok: true, message: '' });
  const connector: TelephonyConnector = {
    status: 'registered',
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    dial: vi.fn(ok),
    answer: vi.fn(ok),
    hangup: vi.fn(ok),
    setMuted: vi.fn(ok),
    setOnHold: vi.fn(ok),
    transfer: vi.fn(ok),
    sendDtmf: vi.fn(ok),
  };
  const emit = (call: CallSnapshot) =>
    act(() => listeners.forEach((listener) => listener({ type: 'call', call })));
  return { connector, emit };
}

test('after a call the agent records the result on the customer who was called', async () => {
  const services = createDemoServices(new Date());
  const customer = (await services.leads.listProspects()).find(
    (prospect) => prospect.assignedAgentId === 'agent-1'
  )!;
  await services.leads.updateDetails(customer.id, { ...customer, phone: '8888-7777' });
  const { connector, emit } = fakePhone();

  render(
    <ServicesContext.Provider value={services}>
      <AuthContext.Provider value={{ session: AGENT_1 } as AuthContextValue}>
        <TelephonyProvider connector={connector}>
          <MemoryRouter>
            <AgentProspectsProvider agentId="agent-1">
              <CallWrapUp />
            </AgentProspectsProvider>
          </MemoryRouter>
        </TelephonyProvider>
      </AuthContext.Provider>
    </ServicesContext.Provider>
  );

  const call: CallSnapshot = {
    id: 'call-1',
    state: 'active',
    direction: 'outbound',
    remoteNumber: '+50688887777',
    startedAt: new Date(Date.now() - 65_000).toISOString(),
    muted: false,
  };
  emit(call);
  expect(screen.queryByLabelText('Después de la llamada')).toBeNull();
  emit({ ...call, state: 'ended' });

  expect(await screen.findByText(customer.businessName)).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole('radio', { name: 'Buzón de voz' }));
  await user.type(screen.getByLabelText('Nota (opcional)'), 'Dejé mensaje');
  await user.click(screen.getByRole('button', { name: 'Guardar nota' }));

  // The card closes once the note is saved.
  await waitFor(() => expect(screen.queryByLabelText('Después de la llamada')).toBeNull());
  const notes = await services.leads.listNotes(customer.id);
  expect(notes.map((note) => note.body)).toContain(
    'Llamada saliente · 01:05 · Buzón de voz\nDejé mensaje'
  );
});
