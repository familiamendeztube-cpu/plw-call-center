import type { Agent } from '@/features/auth/models/agent';

export interface AgentDirectory {
  listAgents(): Promise<Agent[]>;
}
