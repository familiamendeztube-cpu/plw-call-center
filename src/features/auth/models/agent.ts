export const AGENT_IDS = ['agent-1', 'agent-2', 'agent-3'] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}

export interface Agent {
  id: AgentId;
  displayName: string;
}
