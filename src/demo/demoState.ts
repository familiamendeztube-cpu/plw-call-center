import type { AssignmentHistoryEntry } from '@/features/assignment/models/assignment';
import type { Agent } from '@/features/auth/models/agent';
import type { ActivityEvent } from '@/features/presence/models/activity';
import type { AgentPresence } from '@/features/presence/models/availability';
import type { Conversation, Draft } from '@/features/inbox/models/conversation';
import type { Message } from '@/features/inbox/models/message';
import type { Followup } from '@/features/followups/models/followup';
import type { PrivateNote } from '@/features/leads/models/note';
import type { Prospect } from '@/features/leads/models/prospect';
import type { SalesMaterial } from '@/features/sales-materials/models/material';
import { buildDemoConversations } from '@/demo/fixtures/conversations';
import { buildDemoProspects } from '@/demo/fixtures/prospects';
import {
  buildDemoActivity,
  buildDemoFollowups,
  buildDemoMaterials,
  buildDemoNotes,
  buildDemoPresence,
  DEMO_AGENTS,
} from '@/demo/fixtures/operations';

export interface DemoState {
  agents: Agent[];
  presence: AgentPresence[];
  prospects: Prospect[];
  notes: PrivateNote[];
  conversations: Conversation[];
  messages: Message[];
  drafts: Draft[];
  followups: Followup[];
  materials: SalesMaterial[];
  activity: ActivityEvent[];
  assignmentHistory: AssignmentHistoryEntry[];
}

export function createDemoState(now: Date): DemoState {
  const { conversations, messages, drafts } = buildDemoConversations(now);
  return {
    agents: DEMO_AGENTS,
    presence: buildDemoPresence(now),
    prospects: buildDemoProspects(now),
    notes: buildDemoNotes(now),
    conversations,
    messages,
    drafts,
    followups: buildDemoFollowups(now),
    materials: buildDemoMaterials(now),
    activity: buildDemoActivity(now),
    assignmentHistory: [],
  };
}
