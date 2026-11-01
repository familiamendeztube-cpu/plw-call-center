import type { Agent } from '@/features/auth/models/agent';
import type { Prospect } from '@/features/leads/models/prospect';

export function buildAgentNameMap(agents: Agent[]): Record<string, string> {
  return Object.fromEntries(agents.map((agent) => [agent.id, agent.displayName]));
}

export function buildProspectNameMap(prospects: Prospect[]): Record<string, string> {
  return Object.fromEntries(prospects.map((prospect) => [prospect.id, prospect.businessName]));
}
