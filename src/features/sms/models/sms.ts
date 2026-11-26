import type { Message } from '@/features/inbox/models/message';

/** PLW's US number: customers text it, and agents' replies come from it. */
export const PLW_US_SMS_NUMBER = '(754) 799-1065';
/** Telnyx's limit for one text (longer texts arrive as several joined parts). */
export const MAX_SMS = 1600;

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
  /** The customer has texted PLW, so the agent may answer (the server checks again). */
  texted: boolean;
  /** The customer's latest text was STOP: no texts until they write again. */
  stopped: boolean;
}

/** The customer's texts as chat messages, oldest first, and whether the agent may answer. */
export function toSmsThread(prospectId: string, rows: SmsRow[]): SmsThread {
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
    texted: lastIncoming !== undefined,
    stopped: lastIncoming?.is_stop === true,
  };
}
