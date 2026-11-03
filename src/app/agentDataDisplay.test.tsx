import { configure, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, test } from 'vitest';
import { AppRoutes } from '@/app/AppRoutes';
import { ServicesContext } from '@/app/ServicesContext';
import { createDemoServices } from '@/demo/createDemoServices';
import { buildDemoActivity, buildDemoFollowups, DEMO_AGENTS } from '@/demo/fixtures/operations';
import { buildDemoProspects } from '@/demo/fixtures/prospects';
import { AuthProvider } from '@/features/auth/context/AuthProvider';
import type { Agent, AgentId } from '@/features/auth/models/agent';
import type { Session } from '@/features/auth/models/session';
import { CUSTOMER_PARAM } from '@/features/customers/models/customerLinks';
import { TelephonyProvider } from '@/features/telephony/context/TelephonyProvider';
import { getSupabaseClient } from '@/integrations/supabase/client';

configure({ asyncUtilTimeout: 5000 });

const NOW = new Date();
const PROSPECTS = buildDemoProspects(NOW);
const FOLLOWUPS = buildDemoFollowups(NOW);
const ACTIVITY = buildDemoActivity(NOW);
const ADMIN: Session = { role: 'admin', source: 'demo', displayName: 'Administrador' };
const ADMIN_PATHS = [
  '/admin/resumen',
  '/admin/agentes',
  '/admin/prospectos',
  '/admin/asignaciones',
  '/admin/seguimientos',
  '/admin/integraciones',
  '/admin/configuracion',
];

function agentSession({ id, displayName }: Agent): Session {
  return { role: 'agent', source: 'demo', agentId: id, displayName };
}

function renderApp(path: string, session: Session | null = null) {
  const services = createDemoServices(NOW);
  const auth = { ...services.auth, restoreSession: async () => ({ session, notice: null }) };
  render(
    <ServicesContext.Provider value={{ ...services, auth }}>
      <AuthProvider authService={auth}>
        <TelephonyProvider connector={services.telephony}>
          <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
          </MemoryRouter>
        </TelephonyProvider>
      </AuthProvider>
    </ServicesContext.Provider>
  );
}

function clientNames(isShown: (owner: AgentId | null) => boolean): string[] {
  return PROSPECTS.filter(({ assignedAgentId }) => isShown(assignedAgentId)).map(
    ({ businessName }) => businessName
  );
}

// Both sides must have rows, or these checks would pass while looking at nothing.
async function expectOnly(shown: string[], hidden: string[]) {
  expect(shown.length).toBeGreaterThan(0);
  expect(hidden.length).toBeGreaterThan(0);
  for (const text of shown) {
    expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
  }
  for (const text of hidden) {
    expect(screen.queryByText(text)).toBeNull();
  }
}

async function signIn(user: UserEvent, displayName: string) {
  await user.click(await screen.findByRole('radio', { name: new RegExp(displayName) }));
  await user.keyboard('1234');
}

test.each(DEMO_AGENTS)('$displayName only sees their own clients', async (agent) => {
  renderApp('/clientes', agentSession(agent));
  await expectOnly(
    clientNames((owner) => owner === agent.id),
    clientNames((owner) => owner !== agent.id)
  );
});

test.each(DEMO_AGENTS)('$displayName only sees their own follow-ups', async (agent) => {
  const titles = (mine: boolean) =>
    FOLLOWUPS.filter(({ agentId }) => (agentId === agent.id) === mine).map(({ title }) => title);
  renderApp('/seguimientos', agentSession(agent));
  await expectOnly(titles(true), titles(false));
});

test.each(DEMO_AGENTS)('$displayName only sees their own activity', async (agent) => {
  const summaries = (mine: boolean) =>
    ACTIVITY.filter(({ agentId }) => (agentId === agent.id) === mine).map(({ summary }) => summary);
  renderApp('/mi-actividad', agentSession(agent));
  await expectOnly(summaries(true), summaries(false));
});

test.each(DEMO_AGENTS)('$displayName never sees the name of another agent', async (agent) => {
  renderApp('/clientes', agentSession(agent));
  await screen.findByText(clientNames((owner) => owner === agent.id)[0]);
  await expectOnly(
    [agent.displayName],
    DEMO_AGENTS.filter(({ id }) => id !== agent.id).map(({ displayName }) => displayName)
  );
});

test('a link to the client of another agent opens nothing', async () => {
  const [agent, otherAgent] = DEMO_AGENTS;
  const client = PROSPECTS.find(({ assignedAgentId }) => assignedAgentId === otherAgent.id);
  renderApp(`/clientes?${CUSTOMER_PARAM}=${client?.id}`, agentSession(agent));
  await screen.findByText('Selecciona un cliente para comenzar.');
  expect(screen.queryByText(client?.businessName ?? '')).toBeNull();
});

test('a client nobody owns yet is shown to no agent', async () => {
  const unassigned = clientNames((owner) => owner === null);
  expect(unassigned.length).toBeGreaterThan(0);
  renderApp('/clientes', agentSession(DEMO_AGENTS[0]));
  await screen.findByText(clientNames((owner) => owner === 'agent-1')[0]);
  for (const name of unassigned) {
    expect(screen.queryByText(name)).toBeNull();
  }
});

test.each(ADMIN_PATHS)('an agent who opens %s lands on their clients', async (path) => {
  renderApp(path, agentSession(DEMO_AGENTS[0]));
  await screen.findByRole('heading', { name: 'Clientes' });
  expect(screen.queryByRole('link', { name: 'Asignaciones' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Agentes' })).toBeNull();
});

test.each(['/clientes', '/seguimientos', '/mi-actividad', ...ADMIN_PATHS])(
  'someone not signed in who opens %s lands on the login',
  async (path) => {
    renderApp(path);
    await screen.findByRole('heading', { name: 'Ingreso de agentes' });
  }
);

test('the administrator sees every assigned client', async () => {
  renderApp('/admin/prospectos', ADMIN);
  for (const name of clientNames((owner) => owner !== null)) {
    expect((await screen.findAllByText(name)).length).toBeGreaterThan(0);
  }
});

test('the administrator has no agent workspace', async () => {
  renderApp('/clientes', ADMIN);
  await screen.findByRole('link', { name: 'Asignaciones' });
  expect(screen.queryByRole('heading', { name: 'Clientes' })).toBeNull();
});

test('these tests cannot reach the live project', () => {
  expect(() => getSupabaseClient()).toThrow('Supabase no está configurado.');
});

test('the next agent on the same computer starts with a clean workspace', async () => {
  const user = userEvent.setup();
  const firstClient = clientNames((owner) => owner === 'agent-1')[0];
  const secondClient = clientNames((owner) => owner === 'agent-2')[0];
  renderApp('/login');

  await signIn(user, 'Agente 1');
  await screen.findByText(firstClient);
  await user.type(screen.getByLabelText('Número marcado'), '71301928');
  await user.click(screen.getByRole('button', { name: 'Salir' }));

  await signIn(user, 'Agente 2');
  await screen.findByText(secondClient);
  expect(screen.queryByText(firstClient)).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>('Número marcado').value).toBe('');
});
