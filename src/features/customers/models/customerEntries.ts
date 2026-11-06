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

  // Unread first, then the newest message, like WhatsApp: a new chat or reply rises to the top.
  const lastActivity = ({ prospect, conversation }: CustomerEntry) =>
    Date.parse(conversation?.lastMessageAt ?? prospect.createdAt);
  return prospects
    .map((prospect) => ({
      prospect,
      conversation: latestByProspect.get(prospect.id) ?? null,
    }))
    .sort(
      (a, b) =>
        Number(b.conversation?.unread ?? false) - Number(a.conversation?.unread ?? false) ||
        lastActivity(b) - lastActivity(a)
    );
}

export function matchesCustomerQuery(prospect: Prospect, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  // A number matches however it is written: "8888 1234", "8888-1234" or "+506 88881234".
  const digits = normalized.replace(/[\s()+.-]/g, '');
  if (/^\d+$/.test(digits) && prospect.phone.replace(/\D/g, '').includes(digits)) {
    return true;
  }
  return [prospect.businessName, prospect.contactName, prospect.businessCategory].some((value) =>
    value.toLowerCase().includes(normalized)
  );
}
