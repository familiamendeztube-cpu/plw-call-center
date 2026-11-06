import { configure, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, test } from 'vitest';
import { AppRoutes } from '@/app/AppRoutes';
import { ServicesContext } from '@/app/ServicesContext';
import { createDemoServices } from '@/demo/createDemoServices';
import { buildDemoProspects } from '@/demo/fixtures/prospects';
import { AuthProvider } from '@/features/auth/context/AuthProvider';
import type { Session } from '@/features/auth/models/session';
import {
  buildCustomerEntries,
  matchesCustomerQuery,
} from '@/features/customers/models/customerEntries';
import type { Conversation } from '@/features/inbox/models/conversation';
import { TelephonyProvider } from '@/features/telephony/context/TelephonyProvider';

configure({ asyncUtilTimeout: 5000 });

const NOW = new Date();
const [BASE] = buildDemoProspects(NOW);
const AGENT_1: Session = { role: 'agent', source: 'demo', agentId: 'agent-1', displayName: 'Ana' };

function chat(prospectId: string, lastMessageAt: string, unread = false): Conversation {
  return {
    id: `c-${prospectId}`,
    prospectId,
    assignedAgentId: null,
    subject: '',
    status: 'waiting_agent',
    unread,
    lastMessageAt,
  };
}

test('unread customers come first, then the newest message, whatever the name', () => {
  const prospects = ['Alfa', 'Beta', 'Gamma', 'Delta'].map((name) => ({
    ...BASE,
    id: name,
    businessName: name,
    createdAt: '2026-11-01T00:00:00Z',
  }));
  const entries = buildCustomerEntries(prospects, [
    chat('Alfa', '2026-11-05T08:00:00Z'),
    chat('Beta', '2026-11-05T09:00:00Z', true),
    chat('Gamma', '2026-11-05T10:00:00+00:00'),
    // Delta has no messages: its creation date stands in.
  ]);
  expect(entries.map(({ prospect }) => prospect.id)).toEqual(['Beta', 'Gamma', 'Alfa', 'Delta']);
});

test('a phone number is found however the agent types it', () => {
  const prospect = { ...BASE, phone: '+506 8888-1234' };
  for (const typed of ['88881234', '8888 1234', '8888-1234', '+50688881234', '(506) 8888']) {
    expect(matchesCustomerQuery(prospect, typed)).toBe(true);
  }
  expect(matchesCustomerQuery(prospect, '8888 9999')).toBe(false);
  expect(matchesCustomerQuery({ ...prospect, phone: '' }, '8888')).toBe(false);
});

function renderCustomers() {
  const services = createDemoServices(NOW);
  const auth = {
    ...services.auth,
    restoreSession: async () => ({ session: AGENT_1, notice: null }),
  };
  render(
    <ServicesContext.Provider value={{ ...services, auth }}>
      <AuthProvider authService={auth}>
        <TelephonyProvider connector={services.telephony}>
          <MemoryRouter initialEntries={['/clientes']}>
            <AppRoutes />
          </MemoryRouter>
        </TelephonyProvider>
      </AuthProvider>
    </ServicesContext.Provider>
  );
}

const tags = () => within(screen.getByRole('group', { name: 'Filtrar por etapa' }));
const listed = () =>
  within(screen.getByRole('list', { name: 'Clientes asignados' }))
    .getAllByRole('button')
    .map((row) => row.textContent ?? '');

test('the stage tags filter the list and follow a stage change at once', async () => {
  const user = userEvent.setup();
  renderCustomers();
  await screen.findByText('Panadería Los Cedros Demo');
  expect(listed()).toHaveLength(3);

  await user.click(tags().getByRole('button', { name: 'Perdido 1' }));
  expect(listed()).toEqual([expect.stringContaining('Taller Mecánico San Rafael Demo')]);
  // A second click shows everyone again.
  await user.click(tags().getByRole('button', { name: 'Perdido 1' }));
  expect(listed()).toHaveLength(3);

  await user.type(screen.getByRole('searchbox', { name: 'Buscar clientes' }), '2200 0101');
  expect(listed()).toEqual([expect.stringContaining('Panadería Los Cedros Demo')]);
  await user.clear(screen.getByRole('searchbox', { name: 'Buscar clientes' }));

  await user.click(tags().getByRole('button', { name: 'Contactado 1' }));
  await user.click(screen.getByRole('button', { name: /Panadería Los Cedros Demo/ }));
  await user.selectOptions(await screen.findByLabelText('Etapa de venta'), 'won');
  // Moved to Ganado without waiting for the next refresh.
  await tags().findByRole('button', { name: 'Ganado 1' });
  expect(tags().getByRole('button', { name: 'Contactado 0' })).toBeTruthy();
  expect(screen.getByText('Ningún cliente coincide con la búsqueda o la etapa.')).toBeTruthy();
  // Many clicks and keystrokes: the default 5 s runs out when the whole suite shares the machine.
}, 20_000);
