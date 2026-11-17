import { createClient } from 'npm:@supabase/supabase-js@2';

// Streams the ElevenLabs recording of one AI call (a customer's AI request or one of Anna's
// dental calls) to the agent who owns it, or an admin. Administrators may also request a
// short-lived signed download URL (private storage bucket, 10-minute expiry).
// The API key never leaves the server; nothing about the call is logged.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPORT_BUCKET = 'call-audio-exports';
const SIGN_TTL_SECONDS = 600;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function sessionIdFromJwt(jwt: string): string | null {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.session_id === 'string' ? payload.session_id : null;
  } catch {
    return null;
  }
}

async function fetchRecording(apiKey: string, conversationId: string) {
  return await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}/audio`,
    { headers: { 'xi-api-key': apiKey } }
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const apiKey = Deno.env.get('ELEVENLABS_API_KEY') ?? '';
  if (!apiKey) return json({ error: 'La grabación no está configurada todavía.' }, 503);
  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Sesión no válida.' }, 401);
  const token = authorization.slice(7);
  const body = await req.json().catch(() => null);
  // A customer's AI request, one of Anna's dental calls, or an admin download request.
  const dental = typeof body?.dentalCallId === 'string';
  const adminExport = body?.adminExport === true && dental;
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

  if (adminExport) {
    // Only an administrator's current session may mint a download link: the same session
    // resolution the admin console actions use, checked against the service-role view.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: userData } = await admin.auth.getUser(token);
    const sessionId = sessionIdFromJwt(token);
    const { data: resolved } = sessionId
      ? await admin.rpc('resolve_staff_session', {
          p_session_id: sessionId,
          p_auth_user_id: userData?.user?.id ?? '',
        })
      : { data: null };
    const row = Array.isArray(resolved) ? resolved[0] : resolved;
    if (row?.staff_role !== 'admin') return json({ error: 'No autorizado.' }, 403);

    const upstream = await fetchRecording(apiKey, data.conversation_id);
    if (!upstream.ok || !upstream.body) {
      console.error('ai-call-audio export upstream', upstream.status);
      return upstream.status === 404
        ? json({ error: 'ElevenLabs no tiene grabación de esta llamada.' }, 404)
        : json({ error: 'No se pudo obtener la grabación. Intente de nuevo.' }, 502);
    }
    // Private bucket: objects are only reachable through the short-lived signed URL returned
    // here. Re-exporting the same call replaces its object; nothing about the audio is edited.
    const path = `${id}/original.mp3`;
    const { error: uploadError } = await admin.storage
      .from(EXPORT_BUCKET)
      .upload(path, upstream.body, {
        contentType: upstream.headers.get('Content-Type') ?? 'audio/mpeg',
        upsert: true,
      });
    if (uploadError) {
      console.error('ai-call-audio upload', uploadError.message);
      return json({ error: 'No se pudo preparar la descarga. Intente de nuevo.' }, 500);
    }
    const { data: signed, error: signError } = await admin.storage
      .from(EXPORT_BUCKET)
      .createSignedUrl(path, SIGN_TTL_SECONDS);
    if (signError || !signed) {
      console.error('ai-call-audio sign', signError?.message);
      return json({ error: 'No se pudo preparar la descarga. Intente de nuevo.' }, 500);
    }
    // Housekeeping: drop yesterday's leftovers so the bucket holds at most one file per call.
    const { data: stale } = await admin.storage.from(EXPORT_BUCKET).list(id, { limit: 10 });
    const old = (stale ?? []).filter((f) => f.name !== 'original.mp3');
    if (old.length) {
      await admin.storage.from(EXPORT_BUCKET).remove(old.map((f) => `${id}/${f.name}`));
    }
    return json({ url: signed.signedUrl, expiresIn: SIGN_TTL_SECONDS });
  }

  const upstream = await fetchRecording(apiKey, data.conversation_id);
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
