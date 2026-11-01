import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeAdmin, handleAdminAction } from './handlers.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function bearerToken(req: Request) {
  const header = req.headers.get('Authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

    const jwt = bearerToken(req);
    if (!jwt) return json({ error: 'Sesión no válida.' }, 401);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return json({ error: 'Solicitud no válida.' }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const auth = await authorizeAdmin({ admin, jwt });
    if (!auth.ok) return json(auth.body, auth.status);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await handleAdminAction({
      admin,
      userClient,
      actorId: auth.actorId,
      body,
    });
    return json(result.body, result.status);
  } catch (error) {
    console.error('admin-actions failed', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'No se pudo completar la operación. Intente de nuevo.' }, 500);
  }
});
