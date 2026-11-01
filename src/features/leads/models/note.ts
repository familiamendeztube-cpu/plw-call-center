import type { AgentId } from '@/features/auth/models/agent';

export interface PrivateNote {
  id: string;
  prospectId: string;
  agentId: AgentId;
  body: string;
  createdAt: string;
}
