/** Any agent-N: the administrator can add agents, so the list is not fixed. */
export type AgentId = `agent-${number}`;

export function isAgentId(value: string): value is AgentId {
  return /^agent-[0-9]+$/.test(value);
}

export interface Agent {
  id: AgentId;
  displayName: string;
}
