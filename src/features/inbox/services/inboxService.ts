import type { Conversation, Draft } from '@/features/inbox/models/conversation';
import type { Message } from '@/features/inbox/models/message';
import type {
  DraftSaveResult,
  OutboxItem,
  ReplyTarget,
  SendRequestResult,
} from '@/features/inbox/models/reply';

export interface ConversationThread {
  conversation: Conversation;
  messages: Message[];
  draft: Draft | null;
  outbox: OutboxItem[];
}

export interface InboxService {
  listConversations(agentId: string | null): Promise<Conversation[]>;
  getThread(conversationId: string): Promise<ConversationThread | null>;
  getReplyTarget(conversationId: string): Promise<ReplyTarget>;
  saveDraft(conversationId: string, body: string, clientSeq: number): Promise<DraftSaveResult>;
  requestSend(conversationId: string, requestId: string): Promise<SendRequestResult>;
  countUnreadNotifications(): Promise<number>;
  markNotificationsRead(): Promise<void>;
}
