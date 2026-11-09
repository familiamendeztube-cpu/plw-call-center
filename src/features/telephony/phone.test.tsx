import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/features/auth/context/useAuth';
import type { Session } from '@/features/auth/models/session';
import { PhoneBar } from '@/features/telephony/components/PhoneBar';
import { PhoneScreen } from '@/features/telephony/components/PhoneScreen';
import { InCallKeypad } from '@/features/telephony/components/InCallKeypad';
import { RecentCallsList } from '@/features/telephony/components/RecentCallsList';
import { TelephonyProvider } from '@/features/telephony/context/TelephonyProvider';
import { useTelephony } from '@/features/telephony/context/telephonyContext';
import type { CallSnapshot } from '@/features/telephony/models/call';
import type {
  TelephonyConnector,
  TelephonyConnectorEvent,
} from '@/integrations/telephony/telephonyContract';

const AGENT_1: Session = { role: 'agent', source: 'demo', agentId: 'agent-1', displayName: 'Uno' };
const AGENT_2: Session = { role: 'agent', source: 'demo', agentId: 'agent-2', displayName: 'Dos' };
const ADMIN: Session = { role: 'admin', source: 'demo', displayName: 'Administrador' };
const ACTIVE_CALL: CallSnapshot = {
  id: 'call-1',
  state: 'active',
  direction: 'outbound',
  remoteNumber: '88887777',
  startedAt: new Date().toISOString(),
  muted: false,
};
const NO_CALLS = 'Sin llamadas registradas';

function createConnector() {
  const listeners = new Set<(event: TelephonyConnectorEvent) => void>();
  const emit = (event: TelephonyConnectorEvent) => listeners.forEach((listener) => listener(event));
  const result = async () => ({ ok: true, message: '' });
  const connector: TelephonyConnector = {
    status: 'registered',
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    dial: vi.fn(result),
    answer: vi.fn(result),
    hangup: vi.fn(result),
    setMuted: vi.fn(result),
    setOnHold: vi.fn(result),
    transfer: vi.fn(result),
    sendDtmf: vi.fn(result),
  };
  return { connector, emit };
}

function CommandError() {
  return <p>{useTelephony().commandError}</p>;
}

function Phone({ connector, session }: { connector: TelephonyConnector; session: Session | null }) {
  return (
    <AuthContext.Provider value={{ session } as AuthContextValue}>
      <TelephonyProvider connector={connector}>
        <PhoneScreen />
        <InCallKeypad />
        <RecentCallsList />
        <CommandError />
      </TelephonyProvider>
    </AuthContext.Provider>
  );
}

const numberField = () => screen.getByLabelText<HTMLInputElement>('Número marcado');

test('an agent can type straight on the phone screen', async () => {
  const { connector } = createConnector();
  render(<Phone connector={connector} session={AGENT_1} />);
  await userEvent.click(numberField());
  await userEvent.keyboard('71301928');
  expect(numberField().value).toBe('71301928');
});

test('clicking anywhere on the screen puts the cursor in the number', async () => {
  const { connector } = createConnector();
  render(<Phone connector={connector} session={AGENT_1} />);
  await userEvent.click(screen.getByText('Sin llamada'));
  expect(document.activeElement).toBe(numberField());
});

test('the screen drops what cannot be dialed, also from a paste', () => {
  const { connector } = createConnector();
  render(<Phone connector={connector} session={AGENT_1} />);
  fireEvent.change(numberField(), { target: { value: '+506 7130-1928 llamar' } });
  expect(numberField().value).toBe('+50671301928');
});

test('Enter calls the typed number', async () => {
  const { connector } = createConnector();
  render(<Phone connector={connector} session={AGENT_1} />);
  await userEvent.type(numberField(), '71301928{Enter}');
  expect(connector.dial).toHaveBeenCalledExactlyOnceWith('71301928');
});

test('Enter on an empty screen calls nobody', async () => {
  const { connector } = createConnector();
  render(<Phone connector={connector} session={AGENT_1} />);
  await userEvent.type(numberField(), '{Enter}');
  expect(connector.dial).not.toHaveBeenCalled();
});

test('during a call the screen shows the other person and cannot be edited', async () => {
  const { connector, emit } = createConnector();
  render(<Phone connector={connector} session={AGENT_1} />);
  await userEvent.type(numberField(), '71301928');
  act(() => emit({ type: 'call', call: ACTIVE_CALL }));

  expect(numberField().value).toBe('88887777');
  expect(numberField().readOnly).toBe(true);
  await userEvent.type(numberField(), '5{Enter}');
  expect(numberField().value).toBe('88887777');
  expect(connector.dial).not.toHaveBeenCalled();
});

test('the agent can type the next number as soon as a call ends', async () => {
  const { connector, emit } = createConnector();
  render(<Phone connector={connector} session={AGENT_1} />);
  act(() => emit({ type: 'call', call: ACTIVE_CALL }));
  act(() => emit({ type: 'call', call: { ...ACTIVE_CALL, state: 'ended' } }));

  await userEvent.type(numberField(), '2');
  expect(numberField().value).toBe('2');
  expect(screen.queryByText(NO_CALLS)).toBeNull();
});

test('the phone line follows the signed-in agent', () => {
  const { connector } = createConnector();
  const { rerender } = render(<Phone connector={connector} session={AGENT_1} />);
  expect(connector.start).toHaveBeenCalledTimes(1);

  rerender(<Phone connector={connector} session={null} />);
  expect(connector.stop).toHaveBeenCalledTimes(1);

  rerender(<Phone connector={connector} session={AGENT_2} />);
  expect(connector.start).toHaveBeenCalledTimes(2);
});

test('the administrator does not connect a phone line', () => {
  const { connector } = createConnector();
  render(<Phone connector={connector} session={ADMIN} />);
  expect(connector.start).not.toHaveBeenCalled();
});

test('during a call the keypad sends the pressed digit to the line', async () => {
  const { connector, emit } = createConnector();
  render(<Phone connector={connector} session={AGENT_1} />);
  act(() => emit({ type: 'call', call: ACTIVE_CALL }));

  await userEvent.click(screen.getByRole('button', { name: 'Enviar 5' }));
  expect(connector.sendDtmf).toHaveBeenCalledExactlyOnceWith('5');
});

test('the keypad is hidden when no call is active', () => {
  const { connector } = createConnector();
  render(<Phone connector={connector} session={AGENT_1} />);
  expect(screen.queryByRole('button', { name: 'Enviar 5' })).toBeNull();
});

test('the next agent does not inherit the number, calls or errors of the last one', () => {
  const { connector, emit } = createConnector();
  const { rerender } = render(<Phone connector={connector} session={AGENT_1} />);
  fireEvent.change(numberField(), { target: { value: '71301928' } });
  act(() => emit({ type: 'call', call: { ...ACTIVE_CALL, state: 'ended' } }));
  act(() => emit({ type: 'status', status: 'error', message: 'Error del agente 1' }));
  expect(screen.queryByText(NO_CALLS)).toBeNull();
  expect(screen.getByText('Error del agente 1')).toBeTruthy();

  rerender(<Phone connector={connector} session={null} />);
  rerender(<Phone connector={connector} session={AGENT_2} />);

  expect(numberField().value).toBe('');
  expect(screen.getByText(NO_CALLS)).toBeTruthy();
  expect(screen.queryByText('Error del agente 1')).toBeNull();
});

// connector.stop() hangs up, and that hang-up reports the call while the logout runs.
test('a call ended by signing out does not reach the next agent', () => {
  const { connector, emit } = createConnector();
  vi.mocked(connector.stop).mockImplementation(() =>
    emit({ type: 'call', call: { ...ACTIVE_CALL, state: 'ended' } })
  );
  const { rerender } = render(<Phone connector={connector} session={AGENT_1} />);
  act(() => emit({ type: 'call', call: ACTIVE_CALL }));

  rerender(<Phone connector={connector} session={null} />);
  rerender(<Phone connector={connector} session={AGENT_2} />);

  expect(screen.getByText(NO_CALLS)).toBeTruthy();
  expect(numberField().value).toBe('');
  expect(numberField().readOnly).toBe(false);
});

test('a number typed by the administrator does not reach the next agent', () => {
  const { connector } = createConnector();
  const { rerender } = render(<Phone connector={connector} session={ADMIN} />);
  fireEvent.change(numberField(), { target: { value: '71301928' } });

  rerender(<Phone connector={connector} session={AGENT_1} />);
  expect(numberField().value).toBe('');
});

// The dialer pinned on top when the window is too narrow for the full phone.
function NarrowPhone({ connector }: { connector: TelephonyConnector }) {
  return (
    <AuthContext.Provider value={{ session: AGENT_1 } as AuthContextValue}>
      <TelephonyProvider connector={connector}>
        <PhoneBar onOpenPhone={() => undefined} />
      </TelephonyProvider>
    </AuthContext.Provider>
  );
}

test('the narrow dialer calls, holds and hangs up like the full phone', async () => {
  const { connector, emit } = createConnector();
  render(<NarrowPhone connector={connector} />);
  // Before anyone is on the line, the in-call buttons take no room.
  expect(screen.queryByRole('button', { name: 'En espera' })).toBeNull();

  await userEvent.type(numberField(), '71301928');
  await userEvent.click(screen.getByRole('button', { name: 'Llamar' }));
  expect(connector.dial).toHaveBeenCalledExactlyOnceWith('71301928');

  act(() => emit({ type: 'call', call: ACTIVE_CALL }));
  await userEvent.click(screen.getByRole('button', { name: 'En espera' }));
  expect(connector.setOnHold).toHaveBeenCalledWith(true);
  await userEvent.click(screen.getByRole('button', { name: 'Colgar' }));
  expect(connector.hangup).toHaveBeenCalledOnce();
});

test('the narrow dialer answers a ringing call', async () => {
  const { connector, emit } = createConnector();
  render(<NarrowPhone connector={connector} />);
  act(() =>
    emit({ type: 'call', call: { ...ACTIVE_CALL, direction: 'inbound', state: 'ringing' } })
  );

  expect(numberField().value).toBe('88887777');
  await userEvent.click(screen.getByRole('button', { name: 'Contestar' }));
  expect(connector.answer).toHaveBeenCalledOnce();
});
