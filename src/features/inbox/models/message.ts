import type { PrivateNote } from '@/features/leads/models/note';

export type MessageAuthor = 'customer' | 'agent';

export interface Message {
  id: string;
  conversationId: string;
  author: MessageAuthor;
  body: string;
  sentAt: string;
  /** WhatsApp only: photos, voice notes and files sent with the message. */
  attachments?: { kind: string; url: string }[];
  /** WhatsApp only: WhatsApp refused to deliver it. */
  failed?: boolean;
}

export type TimelineEntry =
  | { kind: 'message'; id: string; at: string; message: Message }
  | { kind: 'note'; id: string; at: string; note: PrivateNote };

export function buildTimeline(messages: Message[], notes: PrivateNote[]): TimelineEntry[] {
  const messageEntries: TimelineEntry[] = messages.map((message) => ({
    kind: 'message',
    id: `message-${message.id}`,
    at: message.sentAt,
    message,
  }));
  const noteEntries: TimelineEntry[] = notes.map((note) => ({
    kind: 'note',
    id: `note-${note.id}`,
    at: note.createdAt,
    note,
  }));
  return [...messageEntries, ...noteEntries].sort(
    (first, second) => new Date(first.at).getTime() - new Date(second.at).getTime()
  );
}
