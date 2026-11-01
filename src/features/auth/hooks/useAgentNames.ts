import { useMemo } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import { useAsync } from '@/app/useAsync';

export function useAgentNames(): Record<string, string> {
  const { agents } = useAppServices();
  const { state } = useAsync(() => agents.listAgents(), [agents]);
  return useMemo(() => {
    if (state.status !== 'ready') {
      return {};
    }
    return Object.fromEntries(state.data.map((agent) => [agent.id, agent.displayName]));
  }, [state]);
}
