import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { callFromEvent, readLimited, shouldRouteToAgent, verifySignature } from './rules.js';

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  } });
}

// Reason codes and conversation IDs only: never headers, bodies, names or phone numbers.
async function logFailure(db: SupabaseClient, reason: string, conversationId: string | null = null) {
  console.error('elevenlabs-webhook', reason);
  try {
    await db.from('ai_webhook_failures').insert({ reason, conversation_id: conversationId });
  } catch {
    // The console line above is the fallback record.
  }
}

Deno.serve(async req => {
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('ELEVENLABS_WEBHOOK_SECRET') ?? '';
  // 503 so ElevenLabs retries instead of dropping calls while the secret is being set.
  if (secret.length < 16) return reply({ error: 'Not configured' }, 503);

  const raw = await readLimited(req);
  if (raw === null) return reply({ error: 'Too large' }, 413);
  if (!await verifySignature(req.headers.get('ElevenLabs-Signature'), raw, secret)) {
    return reply({ error: 'Unauthorized' }, 401);
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    await logFailure(db, 'invalid_json');
    return reply({ error: 'Invalid JSON' }, 400);
  }

  const result = callFromEvent(event);
  if (result.ignore) return reply({ ignored: result.ignore });
  if (result.invalid || !result.call) {
    await logFailure(db, result.invalid ?? 'malformed', result.conversationId ?? null);
    return reply({ error: 'Invalid event' }, 400);
  }

  const { data, error } = await db.rpc('record_ai_call', {
    p_call: result.call,
    p_route: shouldRouteToAgent(result.call),
  });
  if (error || typeof data !== 'string') {
    await logFailure(db, 'save_failed', result.call.conversation_id);
    // 5xx: ElevenLabs retries the identical delivery, and record_ai_call is idempotent.
    return reply({ error: 'Save failed' }, 500);
  }
  // Saved, but none of the agent's collected fields could be read: flag it for admins.
  if (result.fieldsIssue) await logFailure(db, result.fieldsIssue, result.call.conversation_id);
  // 200 only after the database confirmed the write.
  return reply({ id: data, fields: result.fieldsIssue ?? 'ok' });
});
