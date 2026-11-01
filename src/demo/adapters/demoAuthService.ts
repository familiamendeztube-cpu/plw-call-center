import type { AuthService } from '@/features/auth/services/authService';
import type { AgentDirectory } from '@/features/auth/services/agentDirectory';
import { DEMO_ADMIN_PIN, DEMO_AGENT_PIN } from '@/features/auth/models/demoAccess';
import type { DemoState } from '@/demo/demoState';
import { simulateLatency } from '@/demo/demoIds';

export function createDemoAuthService(state: DemoState): AuthService {
  return {
    async signInAgent({ agentId, pin }) {
      await simulateLatency();
      const agent = state.agents.find((candidate) => candidate.id === agentId);
      if (!agent) {
        return {
          ok: false,
          message: 'Selecciona un agente para continuar.',
          deviceRequired: false,
        };
      }
      if (pin !== DEMO_AGENT_PIN) {
        return {
          ok: false,
          message: 'PIN incorrecto. Revisa el PIN de demostración.',
          deviceRequired: false,
        };
      }
      return {
        ok: true,
        session: {
          role: 'agent',
          source: 'demo',
          agentId: agent.id,
          displayName: agent.displayName,
        },
      };
    },
    async signInAdmin({ passcode }) {
      await simulateLatency();
      if (passcode !== DEMO_ADMIN_PIN) {
        return {
          ok: false,
          message: 'Contraseña de administrador incorrecta.',
          deviceRequired: false,
        };
      }
      return {
        ok: true,
        session: { role: 'admin', source: 'demo', displayName: 'Administrador' },
      };
    },
    async restoreSession() {
      return { session: null, notice: null };
    },
    async enrollDevice() {
      return null;
    },
    async getOwnerSetupState() {
      return { setupComplete: true, setupAvailable: false };
    },
    async completeOwnerSetup() {
      return {
        ok: false,
        message: 'La configuración inicial no está disponible en demostración.',
        deviceRequired: false,
      };
    },
    async signOut() {},
    onSessionEnded() {
      return () => {};
    },
  };
}

export function createDemoAgentDirectory(state: DemoState): AgentDirectory {
  return {
    async listAgents() {
      await simulateLatency(120);
      return state.agents.map((agent) => ({ ...agent }));
    },
  };
}
