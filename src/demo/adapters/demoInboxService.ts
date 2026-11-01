import type { InboxService } from '@/features/inbox/services/inboxService';
import type { DemoState } from '@/demo/demoState';
import { simulateLatency } from '@/demo/demoIds';

const DEMO_RECIPIENT = 'cliente.demo@ejemplo.com';

export function createDemoInboxService(state: DemoState): InboxService {
  return {
    async listConversations(agentId) {
      await simulateLatency(120);
      return state.conversations
        .filter((conversation) => agentId === null || conversation.assignedAgentId === agentId)
        .sort((first, second) => second.lastMessageAt.localeCompare(first.lastMessageAt))
        .map((conversation) => ({ ...conversation }));
    },
    async getThread(conversationId) {
      await simulateLatency(150);
      const conversation = state.conversations.find((item) => item.id === conversationId);
      if (!conversation) {
        return null;
      }
      state.conversations = state.conversations.map((item) =>
        item.id === conversationId ? { ...item, unread: false } : item
      );
      return {
        conversation: { ...conversation, unread: false },
        messages: state.messages
          .filter((message) => message.conversationId === conversationId)
          .sort((first, second) => first.sentAt.localeCompare(second.sentAt)),
        draft: state.drafts.find((draft) => draft.conversationId === conversationId) ?? null,
        outbox: [],
      };
    },
    async getReplyTarget(conversationId) {
      await simulateLatency(80);
      const conversation = state.conversations.find((item) => item.id === conversationId);
      if (!conversation) return { ok: false, reason: 'sin_correo' };
      return { ok: true, recipient: DEMO_RECIPIENT, subject: `Re: ${conversation.subject}` };
    },
    async saveDraft(conversationId, body) {
      await simulateLatency(200);
      const current = state.drafts.find((draft) => draft.conversationId === conversationId);
      const revision = (current?.revision ?? 0) + 1;
      const updatedAt = new Date().toISOString();
      const draft = { conversationId, body, updatedAt, revision };
      const others = state.drafts.filter((item) => item.conversationId !== conversationId);
      state.drafts = [...others, draft];
      return { applied: true, revision, body, updatedAt };
    },
    async requestSend(conversationId) {
      await simulateLatency(200);
      return {
        outboxId: `demo-outbox-${conversationId}`,
        messageId: `demo-message-${Date.now()}`,
        status: 'queued',
      };
    },
    async countUnreadNotifications() {
      await simulateLatency(60);
      return 0;
    },
    async markNotificationsRead() {
      await simulateLatency(60);
    },
  };
}
