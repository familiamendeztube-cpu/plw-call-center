import type { AgentId } from '@/features/auth/models/agent';
import type { ActivityEvent } from '@/features/presence/models/activity';
import type { AgentPresence, Availability } from '@/features/presence/models/availability';

export interface PresenceService {
  listPresence(): Promise<AgentPresence[]>;
  setAvailability(agentId: AgentId, availability: Availability): Promise<AgentPresence>;
  sendHeartbeat(): Promise<void>;
  /** Tells the team (and Anna's dialer) that the signed-in agent is on a call. */
  setInCall(inCall: boolean): Promise<void>;
  listActivity(agentId: AgentId | null): Promise<ActivityEvent[]>;
}
