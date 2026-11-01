import { useAppServices } from '@/app/ServicesContext';
import { useAsync } from '@/app/useAsync';
import type { AgentId } from '@/features/auth/models/agent';

export function useActivity(agentId: AgentId | null) {
  const { presence } = useAppServices();
  return useAsync(() => presence.listActivity(agentId), [presence, agentId]);
}
