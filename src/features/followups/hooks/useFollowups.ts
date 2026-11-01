import { useAppServices } from '@/app/ServicesContext';
import { useAsync } from '@/app/useAsync';
import type { AgentId } from '@/features/auth/models/agent';

export function useFollowups(agentId: AgentId | null) {
  const { followups } = useAppServices();
  return useAsync(() => followups.listFollowups(agentId), [followups, agentId]);
}
