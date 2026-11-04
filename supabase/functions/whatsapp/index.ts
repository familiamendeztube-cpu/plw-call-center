import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeStaff } from '../telephony/handlers.js';
import { handleWhatsApp } from './handlers.js';

// Agents read and answer their customers' WhatsApp chats in Chatwoot with their own Chatwoot user,
// so every reply carries the agent's own name. Each token is stored encrypted and picked by the
// caller's verified session, never by anything the browser sends. Tokens and message text are
// never returned or logged.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const base = (Deno.env.get('CHATWOOT_URL') ?? '').replace(/\/+$/, '');
  const config = {
    account: Deno.env.get('CHATWOOT_ACCOUNT_ID') ?? '',
    inbox: Deno.env.get('CHATWOOT_INBOX_ID') ?? '',
    tokenKey: Deno.env.get('CHATWOOT_TOKEN_KEY') ?? '',
  };
  if (
    !/^https:\/\//.test(base) ||
    !/^[0-9]+$/.test(config.account) ||
    !/^[0-9]+$/.test(config.inbox) ||
    config.tokenKey.length < 32
  ) {
    return json({ error: 'WhatsApp no está configurado todavía.' }, 503);
  }
  const authorization = req.headers.get('Authorization') ?? '';
  const jwt = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!jwt) return json({ error: 'Sesión no válida.' }, 401);
  const body = await req.json().catch(() => null);
  if (typeof body !== 'object' || body === null) return json({ error: 'Solicitud no válida.' }, 400);

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    // Who is calling comes from the verified, unrevoked session only.
    const staff = await authorizeStaff({ admin, jwt });
    if (!staff) return json({ error: 'Sesión revocada o no válida.' }, 401);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const chatwoot = (path: string, token: string, init: RequestInit = {}) =>
      fetch(`${base}${path}`, {
        ...init,
        headers: { api_access_token: token, 'Content-Type': 'application/json' },
      }).catch(() => null);

    const result = await handleWhatsApp({ staff, body, admin, db, chatwoot, config });
    return json(result.body, result.status);
  } catch (error) {
    // A code or error name only: database errors can quote values.
    const code = (error as { code?: unknown })?.code;
    console.error(
      'whatsapp failed',
      typeof code === 'string' ? code : error instanceof Error ? error.name : 'unknown'
    );
    return json({ error: 'No se pudo completar la operación. Intente de nuevo.' }, 500);
  }
});
