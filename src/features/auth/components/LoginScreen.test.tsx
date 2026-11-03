import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { LoginScreen } from '@/features/auth/components/LoginScreen';
import type { Agent, AgentId } from '@/features/auth/models/agent';

type SignIn = (agentId: AgentId, pin: string) => Promise<string | null>;

const AGENTS: Agent[] = [
  { id: 'agent-1', displayName: 'Jose' },
  { id: 'agent-2', displayName: 'Valeska' },
];

function login(onSignIn: SignIn, deviceRequired = false) {
  return (
    <MemoryRouter>
      <LoginScreen
        agents={AGENTS}
        notice={null}
        deviceRequired={deviceRequired}
        onSignIn={onSignIn}
        onEnrollDevice={async () => null}
      />
    </MemoryRouter>
  );
}

const pinCount = () => screen.getByRole('status', { name: /^PIN:/ }).getAttribute('aria-label');
const chooseAgent = (name: string) =>
  userEvent.click(screen.getByRole('radio', { name: RegExp(name) }));

test('the fourth digit signs in, with no button to press', async () => {
  const onSignIn = vi.fn<SignIn>(async () => null);
  render(login(onSignIn));
  await chooseAgent('Jose');
  await userEvent.keyboard('123');
  expect(onSignIn).not.toHaveBeenCalled();

  await userEvent.keyboard('4');
  expect(onSignIn).toHaveBeenCalledExactlyOnceWith('agent-1', '1234');
  expect(screen.queryByRole('button', { name: 'Ingresar' })).toBeNull();
});

test('the on-screen keypad signs in the same way', async () => {
  const onSignIn = vi.fn<SignIn>(async () => null);
  render(login(onSignIn));
  await chooseAgent('Valeska');
  for (const digit of '4321') {
    await userEvent.click(screen.getByRole('button', { name: `Dígito ${digit}` }));
  }
  expect(onSignIn).toHaveBeenCalledExactlyOnceWith('agent-2', '4321');
});

test('choosing the agent after typing the PIN also signs in', async () => {
  const onSignIn = vi.fn<SignIn>(async () => null);
  render(login(onSignIn));
  await userEvent.keyboard('1234');
  expect(onSignIn).not.toHaveBeenCalled();

  await chooseAgent('Jose');
  expect(onSignIn).toHaveBeenCalledExactlyOnceWith('agent-1', '1234');
});

test('a wrong PIN shows why and can be typed again', async () => {
  const onSignIn = vi.fn<SignIn>().mockResolvedValueOnce('PIN incorrecto.').mockResolvedValue(null);
  render(login(onSignIn));
  await chooseAgent('Jose');
  await userEvent.keyboard('9999');

  expect((await screen.findByRole('alert')).textContent).toBe('PIN incorrecto.');
  expect(pinCount()).toContain('0 de 4');

  await userEvent.keyboard('1234');
  expect(onSignIn).toHaveBeenCalledTimes(2);
  expect(onSignIn).toHaveBeenLastCalledWith('agent-1', '1234');
});

test('one PIN is one sign-in attempt, however often the page redraws', async () => {
  let finish: (message: string | null) => void = () => undefined;
  const signIn = vi.fn<SignIn>(() => new Promise((resolve) => (finish = resolve)));
  // The real page hands LoginScreen a new function on every render.
  const { rerender } = render(login((...args) => signIn(...args)));
  await chooseAgent('Jose');
  await userEvent.keyboard('1234');

  rerender(login((...args) => signIn(...args)));
  rerender(login((...args) => signIn(...args)));
  expect(signIn).toHaveBeenCalledTimes(1);

  finish('PIN incorrecto.');
  await screen.findByRole('alert');
  rerender(login((...args) => signIn(...args)));
  await waitFor(() => expect(pinCount()).toContain('0 de 4'));
  expect(signIn).toHaveBeenCalledTimes(1);
});

test('typing a device registration code is not a PIN', async () => {
  const onSignIn = vi.fn<SignIn>(async () => null);
  render(login(onSignIn, true));
  await chooseAgent('Jose');
  await userEvent.type(screen.getByLabelText('Código de registro'), '483920');

  expect(screen.getByLabelText<HTMLInputElement>('Código de registro').value).toBe('483920');
  expect(pinCount()).toContain('0 de 4');
  expect(onSignIn).not.toHaveBeenCalled();
});
