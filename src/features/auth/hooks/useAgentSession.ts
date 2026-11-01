import { useAuth } from '@/features/auth/context/useAuth';
import type { AgentId } from '@/features/auth/models/agent';

export interface AgentSessionIdentity {
  agentId: AgentId;
  displayName: string;
}

export function useAgentSession(): AgentSessionIdentity {
  const { session } = useAuth();
  if (!session || session.role !== 'agent') {
    throw new Error('Esta vista requiere una sesión de agente.');
  }
  return { agentId: session.agentId, displayName: session.displayName };
}
