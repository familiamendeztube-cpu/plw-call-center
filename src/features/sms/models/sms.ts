import type { Message } from '@/features/inbox/models/message';

/** PLW's US number: customers text it, and agents' replies come from it. */
export const PLW_US_SMS_NUMBER = '(754) 799-1065';
/**
 * Longest text an agent may send. Telnyx sends at most 10 parts, and a text with á, í, ó or ú
 * (almost every Spanish one) goes in parts of 67 characters: 670 in all, minus the ~74 of the
 * STOP line the server adds to the first text. Emoji count as 2, as they do for the carrier.
 */
export const MAX_SMS = 590;

/** One row of sms_messages, as the agent may read it. */
export interface SmsRow {
  id: string;
  direction: 'in' | 'out';
  body: string;
  status: 'received' | 'queued' | 'sent' | 'delivered' | 'failed' | 'suppressed';
  is_stop: boolean;
  created_at: string;
}

export interface SmsThread {
  messages: Message[];
  /** The customer agreed on a call or texted PLW, so the agent may text (the server checks again). */
  allowed: boolean;
  /** The customer's latest text was STOP: no texts until they write again. */
  stopped: boolean;
}

/** The customer's texts as chat messages, oldest first, and whether the agent may text them. */
export function toSmsThread(prospectId: string, rows: SmsRow[], agreedOnCall = false): SmsThread {
  const ordered = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const incoming = ordered.filter((row) => row.direction === 'in');
  const lastIncoming = incoming[incoming.length - 1];
  return {
    messages: ordered.map((row) => ({
      id: row.id,
      conversationId: prospectId,
      author: row.direction === 'in' ? 'customer' : 'agent',
      body: row.body,
      sentAt: row.created_at,
      failed: row.status === 'failed' || row.status === 'suppressed',
    })),
    allowed: agreedOnCall || lastIncoming !== undefined,
    stopped: lastIncoming?.is_stop === true,
  };
}
