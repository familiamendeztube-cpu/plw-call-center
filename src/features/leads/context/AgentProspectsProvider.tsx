import { useMemo, type ReactNode } from 'react';
import type { AgentId } from '@/features/auth/models/agent';
import { useProspects } from '@/features/leads/hooks/useProspects';
import { findCustomerByPhone } from '@/features/customers/models/customerEntries';
import {
  AgentProspectsContext,
  type AgentProspects,
} from '@/features/leads/context/agentProspectsContext';

export function AgentProspectsProvider({
  agentId,
  children,
}: {
  agentId: AgentId;
  children: ReactNode;
}) {
  const { state, reload, updateData } = useProspects();
  const own = useMemo(
    () =>
      state.status === 'ready'
        ? state.data.filter((prospect) => prospect.assignedAgentId === agentId)
        : [],
    [state, agentId]
  );
  const value = useMemo<AgentProspects>(
    () => ({
      state,
      reload,
      updateData,
      own,
      findByPhone: (number) => findCustomerByPhone(own, number),
    }),
    [state, reload, updateData, own]
  );
  return <AgentProspectsContext.Provider value={value}>{children}</AgentProspectsContext.Provider>;
}
