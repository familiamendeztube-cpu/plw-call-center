import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createGmailClient } from './gmailClient.js';
import { runGmailSync } from './syncEngine.js';
import { createSyncStore } from './syncStore.ts';
import { refreshAccessToken } from '../googleApi.js';
import { BUSINESS_MAILBOX, missingSecrets, normalizeMailbox } from '../rules.js';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    },
  });
}

export async function handleSyncTick(admin: SupabaseClient, req: Request, env: Record<string, string>) {
  const { data: authorized, error } = await admin.rpc('gmail_sync_scheduler_matches', {
    p_token: req.headers.get('x-sync-secret') ?? '',
  });
  if (error) throw error;
  if (authorized !== true) return json({ error: 'No autorizado.' }, 401);
  if (missingSecrets(env).length > 0) return json({ status: 'not-configured' });

  const store = createSyncStore(admin, env.PLW_GOOGLE_TOKEN_KEY);
  const result = await runGmailSync({
    store,
    mailbox: normalizeMailbox(BUSINESS_MAILBOX),
    createGmail: async () => {
      const refreshToken = await store.loadRefreshToken();
      const token = await refreshAccessToken(fetch, {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        refreshToken,
      });
      return createGmailClient({ fetchImpl: fetch, accessToken: token.accessToken });
    },
  });
  return json(result);
}
