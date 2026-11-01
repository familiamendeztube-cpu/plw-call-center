import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { decryptRefreshToken } from '../tokenCrypto.js';
import { BUSINESS_MAILBOX, normalizeMailbox } from '../rules.js';

export interface SyncClaim {
  runToken: string;
  connectionVersion: number;
  phase: 'listing' | 'incremental';
  pageToken: string | null;
  historyId: string | null;
  pending: string[] | null;
  targetHistoryId: string | null;
  importFrom: string;
}

export interface CheckpointInput {
  version: number;
  runToken: string;
  phase: string;
  pageToken: string | null;
  historyId: string | null;
  pending: string[] | null;
  targetHistoryId: string | null;
  release: boolean;
  error: string | null;
  success: boolean;
}

export function createSyncStore(admin: SupabaseClient, tokenKey: string) {
  const mailbox = normalizeMailbox(BUSINESS_MAILBOX);

  return {
    async claim(): Promise<SyncClaim | null> {
      const { data, error } = await admin.rpc('gmail_sync_claim');
      if (error) throw error;
      return (data as SyncClaim | null) ?? null;
    },

    async checkpoint(input: CheckpointInput): Promise<boolean> {
      const { data, error } = await admin.rpc('gmail_sync_checkpoint', {
        p_version: input.version,
        p_token: input.runToken,
        p_phase: input.phase,
        p_page_token: input.pageToken,
        p_history_id: input.historyId,
        p_pending: input.pending,
        p_target_history_id: input.targetHistoryId,
        p_release: input.release,
        p_error: input.error,
        p_success: input.success,
      });
      if (error) throw error;
      return data === true;
    },

    async recordMessage(input: {
      version: number;
      runToken: string;
      message: Record<string, unknown>;
    }) {
      const { data, error } = await admin.rpc('gmail_record_message', {
        p_version: input.version,
        p_token: input.runToken,
        p_message: input.message,
      });
      if (error) throw error;
      return data as { outcome: 'created' | 'reply' | 'duplicate' | 'stale' };
    },

    async loadTrustedSenders(): Promise<Set<string>> {
      const { data, error } = await admin
        .from('gmail_lead_notification_senders')
        .select('address')
        .eq('enabled', true);
      if (error) throw error;
      return new Set((data ?? []).map((row) => String(row.address).toLowerCase()));
    },

    async loadRefreshToken(): Promise<string> {
      const { data, error } = await admin
        .from('google_workspace_connections')
        .select('refresh_token_ciphertext')
        .eq('mailbox_address', mailbox)
        .maybeSingle();
      if (error) throw error;
      const ciphertext = data?.refresh_token_ciphertext;
      if (typeof ciphertext !== 'string') throw new Error('refresh-token-missing');
      return decryptRefreshToken(ciphertext, tokenKey);
    },
  };
}
