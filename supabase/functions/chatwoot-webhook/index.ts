import { createClient } from 'npm:@supabase/supabase-js@2';
import { readLimited } from '../elevenlabs-webhook/rules.js';
import { messageFromEvent, verifySignature } from './rules.js';

// Chatwoot calls this for every message in the account. Only customer messages in the WhatsApp
// inbox reach the database. Logs carry reason codes only: never bodies, names or phone numbers.

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  } });
}

Deno.serve(async req => {
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('CHATWOOT_WEBHOOK_SECRET') ?? '';
  const inboxId = Deno.env.get('CHATWOOT_INBOX_ID') ?? '';
  if (secret.length < 16 || !/^[0-9]+$/.test(inboxId)) return reply({ error: 'Not configured' }, 503);

  const raw = await readLimited(req);
  if (raw === null) return reply({ error: 'Too large' }, 413);
  const signed = await verifySignature(
    req.headers.get('X-Chatwoot-Signature'),
    req.headers.get('X-Chatwoot-Timestamp'),
    raw,
    secret
  );
  if (!signed) return reply({ error: 'Unauthorized' }, 401);

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    console.error('chatwoot-webhook', 'invalid_json');
    return reply({ error: 'Invalid JSON' }, 400);
  }
  const result = messageFromEvent(event, inboxId);
  if (result.ignore) return reply({ ignored: result.ignore });
  if (!result.chat) {
    console.error('chatwoot-webhook', result.invalid);
    return reply({ error: 'Invalid event' }, 400);
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await db.rpc('record_whatsapp_message', {
    p_conversation_id: result.chat.conversationId,
    p_phone: result.chat.phone,
    p_name: result.chat.name,
  });
  if (error) {
    console.error('chatwoot-webhook', 'save_failed', result.chat.conversationId);
    return reply({ error: 'Save failed' }, 500);
  }
  return reply({ ok: true });
});
