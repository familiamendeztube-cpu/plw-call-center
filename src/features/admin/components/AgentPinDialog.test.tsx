import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { AgentPinDialog } from '@/features/admin/components/AgentPinDialog';
import type { AdminAgent } from '@/features/admin/models/adminAgents';
import { setAgentPin } from '@/features/admin/services/adminAgentService';

vi.mock('@/features/admin/services/adminAgentService', () => ({
  setAgentPin: vi.fn(async () => undefined),
}));

const AGENT: AdminAgent = {
  id: 'agent-1',
  displayName: 'Jose',
  isEnabled: true,
  maxActiveProspects: null,
  hasPin: false,
};

const newPin = () => screen.getByLabelText<HTMLInputElement>('Nuevo PIN de cuatro dígitos');
const confirmPin = () => screen.getByLabelText<HTMLInputElement>('Confirmar PIN');
const saveButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Guardar PIN' });

function renderDialog() {
  const onSaved = vi.fn();
  render(<AgentPinDialog agent={AGENT} onClose={() => undefined} onSaved={onSaved} />);
  return onSaved;
}

beforeEach(() => {
  vi.mocked(setAgentPin).mockClear();
});

test('typing stops at four digits', async () => {
  renderDialog();
  await userEvent.type(newPin(), '123456789');
  expect(newPin().value).toBe('1234');
});

// A password manager sets the value directly, which maxLength does not stop.
test.each([newPin, confirmPin])('a filled-in value keeps only four digits', (field) => {
  renderDialog();
  fireEvent.change(field(), { target: { value: '20261102Admin99' } });
  expect(field().value).toBe('2026');
});

test('letters are not part of a PIN', async () => {
  renderDialog();
  await userEvent.type(newPin(), '1a2b');
  expect(newPin().value).toBe('12');
});

test('saving needs both fields complete', async () => {
  renderDialog();
  await userEvent.type(newPin(), '1234');
  await userEvent.type(confirmPin(), '123');
  expect(saveButton().disabled).toBe(true);
});

test('two different PINs are not saved', async () => {
  renderDialog();
  await userEvent.type(newPin(), '1234');
  await userEvent.type(confirmPin(), '4321');
  await userEvent.click(saveButton());

  expect(screen.getByRole('alert').textContent).toContain('no coinciden');
  expect(setAgentPin).not.toHaveBeenCalled();
});

test('a matching PIN is saved for that agent', async () => {
  const onSaved = renderDialog();
  await userEvent.type(newPin(), '1234');
  await userEvent.type(confirmPin(), '1234');
  await userEvent.click(saveButton());

  expect(setAgentPin).toHaveBeenCalledExactlyOnceWith('agent-1', '1234');
  expect(onSaved).toHaveBeenCalledTimes(1);
});
