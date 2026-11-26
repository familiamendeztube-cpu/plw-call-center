import { getAppDayKey } from '@/app/dates';
import { contactNumber, type AiCall } from '@/features/ai-calls/models/aiCall';
import type { Followup } from '@/features/followups/models/followup';
import type { Conversation } from '@/features/inbox/models/conversation';
import type { Prospect } from '@/features/leads/models/prospect';

export type TodayKind = 'ai_call' | 'overdue' | 'unread' | 'due_today';

export const TODAY_KIND_LABELS: Record<TodayKind, string> = {
  ai_call: 'Llamada de la IA',
  overdue: 'Seguimiento vencido',
  unread: 'Mensaje sin leer',
  due_today: 'Seguimiento de hoy',
};

export interface TodayItem {
  id: string;
  kind: TodayKind;
  title: string;
  detail: string;
  /** When it came in, or when it is due. */
  at: string;
  /** Opens the customer in Clientes. Null for an AI caller who isn't a customer yet. */
  prospectId: string | null;
  phone: string | null;
  followupId?: string;
}

export interface TodaySources {
  /** The agent's own customers, for names and numbers. */
  prospects: Prospect[];
  followups: Followup[];
  conversations: Conversation[];
  /** Pending AI requests. */
  aiCalls: AiCall[];
}

const RANK: Record<TodayKind, number> = {
  ai_call: 0,
  overdue: 1,
  unread: 2,
  due_today: 3,
};

/**
 * Which item the agent sees first. Negative: a goes first.
 *
 * Default: by kind (a waiting AI caller, then late follow-ups, unread messages, today's
 * follow-ups), then whoever has waited longest. a.at alone would be pure first-come.
 */
export function compareTodayItems(a: TodayItem, b: TodayItem): number {
  return RANK[a.kind] - RANK[b.kind] || Date.parse(a.at) - Date.parse(b.at);
}

export function buildTodayItems(sources: TodaySources, now: Date): TodayItem[] {
  const customers = new Map(sources.prospects.map((prospect) => [prospect.id, prospect]));
  const name = (id: string) => customers.get(id)?.businessName ?? 'Cliente';
  const phone = (id: string) => customers.get(id)?.phone || null;
  const today = getAppDayKey(now);
  const items: TodayItem[] = [];

  for (const call of sources.aiCalls) {
    items.push({
      id: `ai:${call.id}`,
      kind: 'ai_call',
      title: call.businessName || call.customerName || 'Cliente',
      detail: call.reason || call.summary || '',
      at: call.callStartedAt,
      prospectId: call.prospectId,
      phone: contactNumber(call),
    });
  }

  // An AI caller's conversation is unread too; that customer is listed once.
  const aiCallers = new Set(items.map((item) => item.prospectId));

  for (const followup of sources.followups) {
    if (followup.completed) continue;
    const due = new Date(followup.dueAt);
    const kind: TodayKind | null =
      due <= now ? 'overdue' : getAppDayKey(due) === today ? 'due_today' : null;
    if (!kind) continue;
    items.push({
      id: `followup:${followup.id}`,
      kind,
      title: name(followup.prospectId),
      detail: followup.title,
      at: followup.dueAt,
      prospectId: followup.prospectId,
      phone: phone(followup.prospectId),
      followupId: followup.id,
    });
  }

  for (const conversation of sources.conversations) {
    if (!conversation.unread || aiCallers.has(conversation.prospectId)) continue;
    items.push({
      id: `unread:${conversation.id}`,
      kind: 'unread',
      title: name(conversation.prospectId),
      detail: conversation.subject,
      at: conversation.lastMessageAt,
      prospectId: conversation.prospectId,
      phone: phone(conversation.prospectId),
    });
  }

  return items.sort(compareTodayItems);
}
