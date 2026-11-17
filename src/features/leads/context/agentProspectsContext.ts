import { createContext, useContext } from 'react';
import type { useProspects } from '@/features/leads/hooks/useProspects';
import type { Prospect } from '@/features/leads/models/prospect';

export interface AgentProspects extends ReturnType<typeof useProspects> {
  /** The agent's own customers; empty until loaded. */
  own: Prospect[];
  /** The agent's customer with this number, matched on the last 8 digits. */
  findByPhone: (number: string) => Prospect | null;
}

export const AgentProspectsContext = createContext<AgentProspects | null>(null);

/** One customer list for the whole agent workspace: pages, phone and caller ID agree. */
export function useAgentProspects(): AgentProspects {
  const value = useContext(AgentProspectsContext);
  if (!value) throw new Error('useAgentProspects must be used inside AgentProspectsProvider.');
  return value;
}

/** Null outside the agent workspace (the administrator's screens). */
export function useOptionalAgentProspects(): AgentProspects | null {
  return useContext(AgentProspectsContext);
}
