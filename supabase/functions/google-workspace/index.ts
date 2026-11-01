import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  completeAuthorization,
  handleDisconnect,
  handleStart,
  handleStatus,
  handleVerify,
} from './handlers.js';
import { createConnectionStore } from './connectionStore.ts';
import { handleSyncTick } from './sync/syncTickHandler.ts';
import { handleOutboxProcess, handleOutboxTick } from './outbox/outboxRoutes.ts';
import {
  evaluateAdminSession,
  evaluateStaffSession,
  missingSecrets,
  sessionIdFromJwt,
} from './rules.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/google-workspace/oauth/callback`;

interface Actor {
  id: string;
  authUserId: string;
  sessionId: string;
}

interface SessionDecision {
  ok: boolean;
  staffId?: string;
  status?: number;
  error?: string;
}

type SessionEvaluator = (input: { sessionId: string; resolved: unknown }) => SessionDecision;

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

function redirectToApp(origin: string, outcome: string) {
  const location = `${origin.replace(/\/$/, '')}/admin/integraciones?google=${outcome}`;
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: location } });
}

async function requireSession(
  admin: SupabaseClient,
  jwt: string,
  evaluate: SessionEvaluator
): Promise<Actor | Response> {
  const sessionId = sessionIdFromJwt(jwt);
  if (!jwt || !sessionId) return json({ error: 'Sesión no válida.' }, 401);

  const { data: userData, error } = await admin.auth.getUser(jwt);
  if (error || !userData.user) return json({ error: 'Sesión no válida.' }, 401);

  const { data: resolved, error: resolveError } = await admin.rpc('resolve_staff_session', {
    p_session_id: sessionId,
    p_auth_user_id: userData.user.id,
  });
  if (resolveError) throw resolveError;
  const decision = evaluate({ sessionId, resolved });
  if (!decision.ok) return json({ error: decision.error }, decision.status);
  return { id: decision.staffId!, authUserId: userData.user.id, sessionId };
}

function toResponse(result: { status: number; body: unknown }) {
  return json(result.body, result.status);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const env = Deno.env.toObject();
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const deps = {
      db: createConnectionStore(admin),
      env,
      fetchImpl: fetch,
      callbackUrl: CALLBACK_URL,
    };

    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname.endsWith('/oauth/callback')) {
      const origin = env.PLW_APP_ORIGIN?.trim();
      if (!origin) return json({ error: 'Falta configuración en el servidor.' }, 409);
      if (missingSecrets(env).length > 0) return redirectToApp(origin, 'not-configured');
      try {
        return redirectToApp(origin, await completeAuthorization(deps, url));
      } catch (error) {
        console.error('google-workspace callback failed', error instanceof Error ? error.message : 'unknown');
        return redirectToApp(origin, 'failed');
      }
    }
    if (req.method === 'POST' && url.pathname.endsWith('/sync/tick')) {
      return await handleSyncTick(admin, req, env);
    }
    if (req.method === 'POST' && url.pathname.endsWith('/outbox/tick')) {
      return await handleOutboxTick(admin, req, env);
    }
    if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

    const body = await req.json().catch(() => null);
    const action = typeof body?.action === 'string' ? body.action : '';
    if (action === 'outbox-process') {
      const agent = await requireSession(admin, bearerToken(req), evaluateStaffSession);
      if (agent instanceof Response) return agent;
      return await handleOutboxProcess(admin, env);
    }

    const actor = await requireSession(admin, bearerToken(req), evaluateAdminSession);
    if (actor instanceof Response) return actor;

    switch (action) {
      case 'status':
        return toResponse(await handleStatus(deps));
      case 'start':
        return toResponse(await handleStart(deps, actor));
      case 'verify':
        return toResponse(await handleVerify(deps, actor));
      case 'disconnect':
        return toResponse(await handleDisconnect(deps, actor));
      default:
        return json({ error: 'Acción no válida.' }, 400);
    }
  } catch (error) {
    console.error('google-workspace failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'Error interno.' }, 500);
  }
});
