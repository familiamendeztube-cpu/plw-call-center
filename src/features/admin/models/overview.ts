import { getCostaRicaDayKey } from '@/app/dates';
import type { Agent } from '@/features/auth/models/agent';
import type { Availability, AgentPresence } from '@/features/presence/models/availability';
import type { ActivityEvent } from '@/features/presence/models/activity';
import type { Conversation } from '@/features/inbox/models/conversation';
import type { Followup } from '@/features/followups/models/followup';
import type { Prospect } from '@/features/leads/models/prospect';

export interface AdminSnapshot {
  agents: Agent[];
  presence: AgentPresence[];
  prospects: Prospect[];
  conversations: Conversation[];
  followups: Followup[];
  activity: ActivityEvent[];
}

export interface OverviewMetrics {
  totalAgents: number;
  availableAgents: number;
  waitingInquiries: number;
  unansweredConversations: number;
  followupsDueToday: number;
  demosScheduled: number;
  proposalsSent: number;
  recentActivity: ActivityEvent[];
}

export interface AgentWorkload {
  agent: Agent;
  availability: Availability;
  openConversations: number;
  activeProspects: number;
  followupsToday: number;
  lastActivityAt: string | null;
}

function isDueToday(followup: Followup, todayKey: string): boolean {
  return !followup.completed && getCostaRicaDayKey(new Date(followup.dueAt)) === todayKey;
}

function newestFirst(first: ActivityEvent, second: ActivityEvent): number {
  return second.occurredAt.localeCompare(first.occurredAt);
}

export function computeOverviewMetrics(snapshot: AdminSnapshot, now: Date): OverviewMetrics {
  const todayKey = getCostaRicaDayKey(now);
  return {
    totalAgents: snapshot.agents.length,
    availableAgents: snapshot.presence.filter((entry) => entry.availability === 'active').length,
    waitingInquiries: snapshot.conversations.filter(
      (conversation) => conversation.status === 'waiting_agent'
    ).length,
    unansweredConversations: snapshot.conversations.filter(
      (conversation) => conversation.status === 'waiting_agent' && conversation.unread
    ).length,
    followupsDueToday: snapshot.followups.filter((followup) => isDueToday(followup, todayKey))
      .length,
    demosScheduled: snapshot.prospects.filter((prospect) => prospect.stage === 'demo_scheduled')
      .length,
    proposalsSent: snapshot.prospects.filter((prospect) => prospect.stage === 'proposal_sent')
      .length,
    recentActivity: [...snapshot.activity].sort(newestFirst).slice(0, 8),
  };
}

export function computeAgentWorkloads(snapshot: AdminSnapshot, now: Date): AgentWorkload[] {
  const todayKey = getCostaRicaDayKey(now);
  return snapshot.agents.map((agent) => {
    const presence = snapshot.presence.find((entry) => entry.agentId === agent.id);
    const agentActivity = snapshot.activity
      .filter((event) => event.agentId === agent.id)
      .sort(newestFirst);
    return {
      agent,
      availability: presence?.availability ?? 'paused',
      openConversations: snapshot.conversations.filter(
        (conversation) =>
          conversation.assignedAgentId === agent.id && conversation.status !== 'closed'
      ).length,
      activeProspects: snapshot.prospects.filter(
        (prospect) =>
          prospect.assignedAgentId === agent.id &&
          prospect.stage !== 'won' &&
          prospect.stage !== 'lost'
      ).length,
      followupsToday: snapshot.followups.filter(
        (followup) => followup.agentId === agent.id && isDueToday(followup, todayKey)
      ).length,
      lastActivityAt: agentActivity[0]?.occurredAt ?? null,
    };
  });
}
