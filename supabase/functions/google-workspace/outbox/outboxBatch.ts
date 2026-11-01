import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createGmailSender } from './gmailSender.js';
import { processOutboxOnce } from './outboxProcessor.js';
import { createOutboxStore } from './outboxStore.ts';
import { createSyncStore } from '../sync/syncStore.ts';
import { refreshAccessToken } from '../googleApi.js';

const MAX_ITEMS_PER_RUN = 5;

export async function processOutboxBatch(
  admin: SupabaseClient,
  env: Record<string, string>
): Promise<string[]> {
  const refreshToken = await createSyncStore(admin, env.PLW_GOOGLE_TOKEN_KEY).loadRefreshToken();
  const token = await refreshAccessToken(fetch, {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken,
  });
  const deps = {
    store: createOutboxStore(admin),
    sender: createGmailSender({ fetchImpl: fetch, accessToken: token.accessToken }),
    now: () => new Date(),
  };

  const outcomes: string[] = [];
  for (let run = 0; run < MAX_ITEMS_PER_RUN; run += 1) {
    const outcome = await processOutboxOnce(deps);
    if (outcome === 'idle') break;
    outcomes.push(outcome);
  }
  return outcomes;
}
