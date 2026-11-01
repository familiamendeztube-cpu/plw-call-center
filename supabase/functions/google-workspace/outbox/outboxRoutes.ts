import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { processOutboxBatch } from './outboxBatch.ts';
import { missingSecrets } from '../rules.js';

const NOT_CONNECTED_MESSAGE = 'Google no está conectado. El administrador debe conectar la cuenta del buzón.';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    },
  });
}

export async function handleOutboxProcess(admin: SupabaseClient, env: Record<string, string>) {
  if (missingSecrets(env).length > 0) return json({ error: 'Falta configuración en el servidor.' }, 409);
  try {
    const outcomes = await processOutboxBatch(admin, env);
    return json({ processed: outcomes.length, outcomes });
  } catch (error) {
    if (error instanceof Error && error.message === 'refresh-token-missing') {
      return json({ error: NOT_CONNECTED_MESSAGE }, 409);
    }
    throw error;
  }
}

export async function handleOutboxTick(admin: SupabaseClient, req: Request, env: Record<string, string>) {
  const { data: authorized, error } = await admin.rpc('gmail_sync_scheduler_matches', {
    p_token: req.headers.get('x-sync-secret') ?? '',
  });
  if (error) throw error;
  if (authorized !== true) return json({ error: 'No autorizado.' }, 401);
  return handleOutboxProcess(admin, env);
}
