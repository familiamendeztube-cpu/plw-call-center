import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface OutboxItem {
  action: 'send' | 'reconcile' | 'blocked';
  id: string;
  claimToken: string;
  mailbox: string;
  recipient: string;
  subject: string;
  body: string;
  rfcMessageId: string;
  threadId: string | null;
  inReplyTo: string | null;
  references: string;
  sourceGmailMessageId: string | null;
}

export interface SettleExtra {
  gmailMessageId?: string;
  gmailThreadId?: string;
  error?: string;
}

export function createOutboxStore(admin: SupabaseClient) {
  return {
    async claim(leaseSeconds: number): Promise<OutboxItem | null> {
      const { data, error } = await admin.rpc('gmail_outbox_claim', { p_lease_seconds: leaseSeconds });
      if (error) throw error;
      return (data as OutboxItem | null) ?? null;
    },

    async settle(item: OutboxItem, outcome: string, extra: SettleExtra = {}): Promise<boolean> {
      const { data, error } = await admin.rpc('gmail_outbox_settle', {
        p_id: item.id,
        p_token: item.claimToken,
        p_outcome: outcome,
        p_gmail_message_id: extra.gmailMessageId ?? null,
        p_gmail_thread_id: extra.gmailThreadId ?? null,
        p_error: extra.error ?? null,
      });
      if (error) throw error;
      return data === true;
    },

    async setHeaders(item: OutboxItem, source: { messageId: string; references: string }): Promise<boolean> {
      const { data, error } = await admin.rpc('gmail_outbox_set_headers', {
        p_id: item.id,
        p_token: item.claimToken,
        p_rfc_message_id: source.messageId,
        p_source_references: source.references,
      });
      if (error) throw error;
      return data === true;
    },
  };
}
