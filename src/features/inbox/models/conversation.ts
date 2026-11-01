export type ConversationStatus = 'waiting_agent' | 'waiting_customer' | 'closed';

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  waiting_agent: 'Esperando respuesta',
  waiting_customer: 'Respondida',
  closed: 'Cerrada',
};

export interface Conversation {
  id: string;
  prospectId: string;
  assignedAgentId: string | null;
  subject: string;
  status: ConversationStatus;
  unread: boolean;
  lastMessageAt: string;
}

export interface Draft {
  conversationId: string;
  body: string;
  updatedAt: string;
  revision: number;
}
