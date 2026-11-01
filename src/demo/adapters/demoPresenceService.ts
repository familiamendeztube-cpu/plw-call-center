import type { AgentId } from '@/features/auth/models/agent';
import type { PresenceService } from '@/features/presence/services/presenceService';
import type { Availability } from '@/features/presence/models/availability';
import type { DemoState } from '@/demo/demoState';
import { simulateLatency } from '@/demo/demoIds';

export function createDemoPresenceService(state: DemoState): PresenceService {
  return {
    async listPresence() {
      await simulateLatency(120);
      return state.presence.map((entry) => ({ ...entry }));
    },
    async setAvailability(agentId: AgentId, availability: Availability) {
      await simulateLatency(120);
      const updated = { agentId, availability, updatedAt: new Date().toISOString() };
      state.presence = state.presence.map((entry) => (entry.agentId === agentId ? updated : entry));
      return updated;
    },
    async sendHeartbeat() {},
    async listActivity(agentId) {
      await simulateLatency(120);
      return state.activity
        .filter((event) => agentId === null || event.agentId === agentId)
        .sort((first, second) => second.occurredAt.localeCompare(first.occurredAt));
    },
  };
}
