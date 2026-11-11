import { createClient } from 'npm:@supabase/supabase-js@2';

// Streams the ElevenLabs recording of one AI call (a customer's AI request or one of Anna's
// dental calls) to the agent who owns it, or an admin.
// The API key never leaves the server; nothing about the call is logged.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const apiKey = Deno.env.get('ELEVENLABS_API_KEY') ?? '';
  if (!apiKey) return json({ error: 'La grabación no está configurada todavía.' }, 503);
  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Sesión no válida.' }, 401);
  const body = await req.json().catch(() => null);
  // A customer's AI request, or one of Anna's dental calls.
  const dental = typeof body?.dentalCallId === 'string';
  const id = dental ? body.dentalCallId : typeof body?.requestId === 'string' ? body.requestId : '';
  if (!UUID.test(id)) return json({ error: 'Solicitud no válida.' }, 400);

  // The caller's own session: row-level security returns the call only to the customer's
  // agent (or, for a dental call, the agent who owns it) or an administrator, and rejects
  // revoked sessions.
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db
    .from(dental ? 'dental_calls' : 'ai_call_requests')
    .select('conversation_id')
    .eq('id', id)
    .maybeSingle();
  if (error) return json({ error: 'Sesión no válida.' }, 401);
  // Same answer for "does not exist" and "not yours".
  if (!data) return json({ error: 'Llamada no encontrada.' }, 404);
  if (!data.conversation_id) return json({ error: 'Esta llamada no tiene grabación.' }, 404);

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(data.conversation_id)}/audio`,
    { headers: { 'xi-api-key': apiKey } }
  );
  if (!upstream.ok || !upstream.body) {
    console.error('ai-call-audio upstream', upstream.status);
    return upstream.status === 404
      ? json({ error: 'ElevenLabs no tiene grabación de esta llamada.' }, 404)
      : json({ error: 'No se pudo obtener la grabación. Intente de nuevo.' }, 502);
  }
  return new Response(upstream.body, {
    headers: {
      ...corsHeaders,
      'Content-Type': upstream.headers.get('Content-Type') ?? 'audio/mpeg',
      'Cache-Control': 'private, no-store',
    },
  });
});
