import type { InboxService } from '@/features/inbox/services/inboxService';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { readOptionalRow, readRows } from '@/production/adapters/productionRows';
import { toConversation, toDraft, toMessage } from '@/production/adapters/productionMappers';
import {
  parseDraftSave,
  parseReplyTarget,
  parseSendRequest,
  toOutboxItem,
} from '@/production/adapters/productionReplyMappers';

const LOAD_ERROR = 'No se pudo cargar la bandeja de conversaciones.';
const THREAD_ERROR = 'No se pudo cargar la conversación.';
const DRAFT_ERROR = 'No se pudo guardar el borrador.';
const REPLY_TARGET_ERROR = 'No se pudo consultar el destinatario de la respuesta.';
const SEND_ERROR = 'No se pudo registrar el envío del correo.';
const NOTIFICATION_ERROR = 'No se pudieron cargar las notificaciones.';
const CONVERSATION_COLUMNS =
  'id, prospect_id, subject, status, unread, last_message_at, prospects!inner(owner_id)';

export function createProductionInboxService(): InboxService {
  const supabase = getSupabaseClient();

  return {
    async listConversations(agentId) {
      let query = supabase
        .from('conversations')
        .select(CONVERSATION_COLUMNS)
        .order('last_message_at', { ascending: false });
      if (agentId !== null) {
        query = query.eq('prospects.owner_id', agentId);
      }
      const { data, error } = await query;
      if (error) throw new Error(LOAD_ERROR);
      return readRows(data).map(toConversation);
    },

    async getThread(conversationId) {
      const [conversationResult, messagesResult, draftResult, outboxResult] = await Promise.all([
        supabase
          .from('conversations')
          .select(CONVERSATION_COLUMNS)
          .eq('id', conversationId)
          .maybeSingle(),
        supabase
          .from('messages')
          .select('id, conversation_id, author, body, sent_at')
          .eq('conversation_id', conversationId)
          .order('sent_at', { ascending: true }),
        supabase
          .from('drafts')
          .select('conversation_id, body, updated_at, revision')
          .eq('conversation_id', conversationId)
          .maybeSingle(),
        supabase
          .from('gmail_outbox')
          .select('id, message_id, status, last_error, sent_at')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);
      if (
        conversationResult.error ||
        messagesResult.error ||
        draftResult.error ||
        outboxResult.error
      ) {
        throw new Error(THREAD_ERROR);
      }
      const conversationRow = readOptionalRow(conversationResult.data);
      if (!conversationRow) return null;
      const conversation = toConversation(conversationRow);
      if (conversation.unread) {
        const { error } = await supabase.rpc('mark_conversation_read', {
          p_conversation_id: conversationId,
        });
        if (error) throw new Error(THREAD_ERROR);
      }
      const draftRow = readOptionalRow(draftResult.data);
      return {
        conversation: { ...conversation, unread: false },
        messages: readRows(messagesResult.data).map(toMessage),
        draft: draftRow ? toDraft(draftRow) : null,
        outbox: readRows(outboxResult.data).map(toOutboxItem),
      };
    },

    async getReplyTarget(conversationId) {
      const { data, error } = await supabase.rpc('get_reply_target', {
        p_conversation_id: conversationId,
      });
      if (error) throw new Error(REPLY_TARGET_ERROR);
      return parseReplyTarget(data);
    },

    async saveDraft(conversationId, body, clientSeq) {
      const { data, error } = await supabase.rpc('save_draft', {
        p_conversation_id: conversationId,
        p_body: body,
        p_client_seq: clientSeq,
      });
      if (error) throw new Error(DRAFT_ERROR);
      return parseDraftSave(data);
    },

    async requestSend(conversationId, requestId) {
      const { data, error } = await supabase.rpc('request_reply_send', {
        p_conversation_id: conversationId,
        p_request_id: requestId,
      });
      if (error) throw new Error(SEND_ERROR);
      return parseSendRequest(data);
    },

    async countUnreadNotifications() {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);
      if (error || count === null) throw new Error(NOTIFICATION_ERROR);
      return count;
    },

    async markNotificationsRead() {
      const { error } = await supabase.rpc('mark_notifications_read');
      if (error) throw new Error(NOTIFICATION_ERROR);
    },
  };
}
