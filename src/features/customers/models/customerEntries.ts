import type { Conversation } from '@/features/inbox/models/conversation';
import type { Prospect } from '@/features/leads/models/prospect';

export interface CustomerEntry {
  prospect: Prospect;
  conversation: Conversation | null;
}

export function buildCustomerEntries(
  prospects: Prospect[],
  conversations: Conversation[]
): CustomerEntry[] {
  const latestByProspect = new Map<string, Conversation>();
  for (const conversation of conversations) {
    const current = latestByProspect.get(conversation.prospectId);
    if (!current || conversation.lastMessageAt > current.lastMessageAt) {
      latestByProspect.set(conversation.prospectId, conversation);
    }
  }

  return prospects
    .map((prospect) => ({
      prospect,
      conversation: latestByProspect.get(prospect.id) ?? null,
    }))
    .sort(
      (a, b) =>
        Number(b.conversation?.unread ?? false) - Number(a.conversation?.unread ?? false) ||
        a.prospect.businessName.localeCompare(b.prospect.businessName, 'es')
    );
}

export function matchesCustomerQuery(prospect: Prospect, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  return [prospect.businessName, prospect.contactName, prospect.businessCategory].some((value) =>
    value.toLowerCase().includes(normalized)
  );
}
