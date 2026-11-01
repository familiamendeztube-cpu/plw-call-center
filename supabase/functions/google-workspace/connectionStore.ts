import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { MAILBOX_KEY } from './handlers.js';

export interface SaveGuard {
  expectedVersion: number | null;
  sessionId: string;
  authUserId: string;
  staffId: string;
}

export type SaveReason = 'saved' | 'superseded' | 'session-ended';

export interface ConnectionRow {
  status: 'disconnected' | 'connected' | 'error';
  connected_account: string | null;
  refresh_token_ciphertext: string | null;
  connected_at: string | null;
  last_verified_at: string | null;
  last_error: string | null;
  scopes: string[] | null;
  connection_version: number;
}

export interface StateRow {
  id: string;
  staff_id: string;
  auth_user_id: string;
  session_id: string;
  connection_version: number | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export function createConnectionStore(admin: SupabaseClient) {
  return {
    async getConnection(): Promise<ConnectionRow | null> {
      const { data, error } = await admin
        .from('google_workspace_connections')
        .select(
          'status, connected_account, refresh_token_ciphertext, connected_at, last_verified_at, last_error, scopes, connection_version',
        )
        .eq('mailbox_address', MAILBOX_KEY)
        .maybeSingle();
      if (error) throw error;
      return data as ConnectionRow | null;
    },

    async createState(state: {
      stateHash: string;
      staffId: string;
      authUserId: string;
      sessionId: string;
      connectionVersion: number;
      expiresAt: string;
    }) {
      await admin.from('google_oauth_states').delete().lt('expires_at', new Date().toISOString());
      const { error } = await admin.from('google_oauth_states').insert({
        state_hash: state.stateHash,
        staff_id: state.staffId,
        auth_user_id: state.authUserId,
        session_id: state.sessionId,
        connection_version: state.connectionVersion,
        expires_at: state.expiresAt,
      });
      if (error) throw error;
    },

    async findState(stateHash: string): Promise<StateRow | null> {
      const { data, error } = await admin
        .from('google_oauth_states')
        .select('id, staff_id, auth_user_id, session_id, connection_version, created_at, expires_at, used_at')
        .eq('state_hash', stateHash)
        .maybeSingle();
      if (error) throw error;
      return data as StateRow | null;
    },

    async claimState(id: string): Promise<boolean> {
      const nowIso = new Date().toISOString();
      const { data, error } = await admin
        .from('google_oauth_states')
        .update({ used_at: nowIso })
        .eq('id', id)
        .is('used_at', null)
        .gt('expires_at', nowIso)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      return data !== null;
    },

    async resolveSession(sessionId: string, authUserId: string) {
      const { data, error } = await admin.rpc('resolve_staff_session', {
        p_session_id: sessionId,
        p_auth_user_id: authUserId,
      });
      if (error) throw error;
      return data;
    },

    async saveConnection(
      guard: SaveGuard,
      patch: Record<string, unknown>,
      requireStatus: string | null,
    ): Promise<SaveReason> {
      const { data, error } = await admin.rpc('save_google_connection', {
        p_mailbox: MAILBOX_KEY,
        p_expected_version: guard.expectedVersion,
        p_session_id: guard.sessionId,
        p_auth_user_id: guard.authUserId,
        p_staff_id: guard.staffId,
        p_patch: patch,
        p_require_status: requireStatus,
      });
      if (error) throw error;
      return data as SaveReason;
    },

    async disconnect(actor: { id: string; authUserId: string; sessionId: string }) {
      const { data, error } = await admin.rpc('disconnect_google_connection', {
        p_mailbox: MAILBOX_KEY,
        p_session_id: actor.sessionId,
        p_auth_user_id: actor.authUserId,
        p_staff_id: actor.id,
      });
      if (error) throw error;
      const row = (data as Array<{ new_version: number; previous_ciphertext: string | null }> | null)?.[0];
      if (!row) return null;
      return { newVersion: row.new_version, previousCiphertext: row.previous_ciphertext };
    },
  };
}
