import type { AgentId } from '@/features/auth/models/agent';
import type { ActivityEvent } from '@/features/presence/models/activity';
import type { AgentPresence, Availability } from '@/features/presence/models/availability';

export interface PresenceService {
  listPresence(): Promise<AgentPresence[]>;
  setAvailability(agentId: AgentId, availability: Availability): Promise<AgentPresence>;
  sendHeartbeat(): Promise<void>;
  listActivity(agentId: AgentId | null): Promise<ActivityEvent[]>;
}
