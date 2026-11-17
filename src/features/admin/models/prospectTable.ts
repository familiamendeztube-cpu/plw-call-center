import type { Conversation } from '@/features/inbox/models/conversation';
import type { Prospect } from '@/features/leads/models/prospect';

export const STALE_DAYS = 7;

/** The newest message with the customer, or when they arrived if there is none yet. */
export function lastContactByProspect(
  prospects: Prospect[],
  conversations: Conversation[]
): Map<string, string> {
  const last = new Map(prospects.map((prospect) => [prospect.id, prospect.createdAt]));
  for (const conversation of conversations) {
    const current = last.get(conversation.prospectId);
    if (current !== undefined && conversation.lastMessageAt > current) {
      last.set(conversation.prospectId, conversation.lastMessageAt);
    }
  }
  return last;
}

/** Still open and nothing heard for a week. */
export function isStale(prospect: Prospect, lastContact: string | undefined, now: number): boolean {
  if (prospect.stage === 'won' || prospect.stage === 'lost' || !lastContact) return false;
  return now - Date.parse(lastContact) > STALE_DAYS * 86_400_000;
}

/**
 * A spreadsheet file. Every cell is quoted; a cell that starts like a formula gets a leading
 * apostrophe so Excel shows a customer's "=..." name as text instead of running it.
 */
export function toCsv(rows: string[][]): string {
  const cell = (value: string) => {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
