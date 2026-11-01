import type { FollowupService } from '@/features/followups/services/followupService';
import type { DemoState } from '@/demo/demoState';
import { createDemoId, simulateLatency } from '@/demo/demoIds';

export function createDemoFollowupService(state: DemoState): FollowupService {
  return {
    async listFollowups(agentId) {
      await simulateLatency(120);
      return state.followups
        .filter((followup) => agentId === null || followup.agentId === agentId)
        .sort((first, second) => first.dueAt.localeCompare(second.dueAt))
        .map((followup) => ({ ...followup }));
    },
    async scheduleFollowup(input) {
      await simulateLatency(180);
      const followup = { id: createDemoId('followup'), completed: false, ...input };
      state.followups = [...state.followups, followup];
      state.activity = [
        {
          id: createDemoId('activity'),
          agentId: input.agentId,
          kind: 'followup',
          summary: `Programó seguimiento: ${input.title}`,
          occurredAt: new Date().toISOString(),
        },
        ...state.activity,
      ];
      return followup;
    },
    async setCompleted(followupId, completed) {
      await simulateLatency(120);
      const current = state.followups.find((item) => item.id === followupId);
      if (!current) {
        throw new Error('No se encontró el seguimiento.');
      }
      const updated = { ...current, completed };
      state.followups = state.followups.map((item) => (item.id === followupId ? updated : item));
      return updated;
    },
  };
}
