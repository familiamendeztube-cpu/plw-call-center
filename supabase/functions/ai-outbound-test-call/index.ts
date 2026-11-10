import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY') ?? '';

const COSTA_RICA_NUMBER = /^(?:\+?506)?([2-8]\d{7})$/;
const STAFF_ID = /^[a-z]+-\d{1,6}$/;
const MAX_ACTIVE_TEST_CALLS = 2;
const ACTIVE_WINDOW_MINUTES = 15;
const DUPLICATE_WINDOW_MINUTES = 5;
const CONTACT_FALLBACK = 'el responsable';

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

function readText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

interface TestCallInput {
  phone: string;
  businessName: string;
  businessType: string;
  transferStaffId: string | null;
}

function parseInput(body: Record<string, unknown>): TestCallInput | string {
  const digits = typeof body.phone === 'string' ? body.phone.replace(/[\s()-]/g, '') : '';
  const match = COSTA_RICA_NUMBER.exec(digits);
  if (!match) return 'Escribe un número de Costa Rica de 8 dígitos.';
  const businessName = readText(body.businessName, 160);
  if (!businessName) return 'Escribe el nombre de la empresa (máximo 160 caracteres).';
  const businessType = readText(body.businessType, 120);
  if (!businessType) return 'Escribe el tipo de negocio (máximo 120 caracteres).';
  let transferStaffId: string | null = null;
  if (body.transferStaffId !== undefined && body.transferStaffId !== null) {
    const id = readText(body.transferStaffId, 40);
    if (!id || !STAFF_ID.test(id)) return 'Elige un agente válido.';
    transferStaffId = id;
  }
  return { phone: match[1], businessName, businessType, transferStaffId };
}

async function startTestCall(admin: ReturnType<typeof createClient>, actorId: string, input: TestCallInput) {
  const { data: settings, error: settingsError } = await admin
    .from('ai_outbound_settings')
    .select('test_agent_id, caller_phone_number_id, voice_id')
    .eq('id', 1)
    .maybeSingle();
  if (settingsError) throw settingsError;
  if (!settings) return json({ error: 'El marcador IA no está configurado todavía.' }, 409);

  if (input.transferStaffId) {
    const { data: agent, error: agentError } = await admin
      .from('staff_profiles')
      .select('id')
      .eq('id', input.transferStaffId)
      .eq('role', 'agent')
      .eq('is_enabled', true)
      .maybeSingle();
    if (agentError) throw agentError;
    if (!agent) return json({ error: 'El agente elegido ya no está disponible.' }, 400);
  }

  const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MINUTES * 60_000).toISOString();
  const { count: activeCount, error: activeError } = await admin
    .from('ai_outbound_test_calls')
    .select('id', { count: 'exact', head: true })
    .in('status', ['starting', 'started'])
    .gte('created_at', activeSince);
  if (activeError) throw activeError;
  if ((activeCount ?? 0) >= MAX_ACTIVE_TEST_CALLS) {
    return json({ error: 'Ya hay dos llamadas de prueba en curso. Espera a que terminen.' }, 429);
  }

  const duplicateSince = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60_000).toISOString();
  const { count: duplicateCount, error: duplicateError } = await admin
    .from('ai_outbound_test_calls')
    .select('id', { count: 'exact', head: true })
    .eq('to_phone', input.phone)
    .in('status', ['starting', 'started'])
    .gte('created_at', duplicateSince);
  if (duplicateError) throw duplicateError;
  if ((duplicateCount ?? 0) > 0) {
    return json({ error: 'Ese número ya tiene una llamada de prueba reciente.' }, 409);
  }

  const { data: row, error: insertError } = await admin
    .from('ai_outbound_test_calls')
    .insert({
      to_phone: input.phone,
      business_name: input.businessName,
      business_type: input.businessType,
      transfer_staff_id: input.transferStaffId,
      created_by: actorId,
    })
    .select('id')
    .single();
  if (insertError) throw insertError;

  const response = await fetch('https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call', {
    method: 'POST',
    headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_id: settings.test_agent_id,
      agent_phone_number_id: settings.caller_phone_number_id,
      to_number: `+506${input.phone}`,
      conversation_initiation_client_data: {
        dynamic_variables: {
          business_name: input.businessName,
          business_type: input.businessType,
          contact_name: CONTACT_FALLBACK,
        },
      },
    }),
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const conversationId =
    typeof payload?.conversation_id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(payload.conversation_id)
      ? payload.conversation_id
      : null;

  if (!response.ok || !conversationId) {
    console.error('ai-outbound-test-call provider rejected', response.status);
    await admin
      .from('ai_outbound_test_calls')
      .update({ status: 'failed', error: 'El proveedor de llamadas rechazó la solicitud.' })
      .eq('id', row.id);
    return json({ error: 'No se pudo iniciar la llamada. Revisa la línea telefónica e intenta de nuevo.' }, 502);
  }

  const { error: updateError } = await admin
    .from('ai_outbound_test_calls')
    .update({ status: 'started', conversation_id: conversationId })
    .eq('id', row.id);
  if (updateError) throw updateError;

  return json({ id: row.id, status: 'started', conversationId }, 201);
}

function sessionIdFromJwt(jwt: string): string | null {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.session_id === 'string' ? payload.session_id : null;
  } catch {
    return null;
  }
}

function evaluateAdminSession({ sessionId, resolved }: { sessionId: string | null; resolved: unknown }) {
  const row = (Array.isArray(resolved) ? resolved[0] : resolved) as Record<string, unknown> | null | undefined;
  if (!sessionId || !row) return { ok: false as const, status: 401, error: 'Sesión revocada o no válida.' };
  if (row.staff_role !== 'admin') return { ok: false as const, status: 403, error: 'No autorizado.' };
  return { ok: true as const, staffId: String(row.staff_id) };
}

async function authorizeAdmin({ admin, jwt }: { admin: ReturnType<typeof createClient>; jwt: string }) {
  const sessionId = sessionIdFromJwt(jwt);
  const { data: userData, error } = await admin.auth.getUser(jwt);
  if (error || !userData?.user) {
    return { ok: false as const, status: 401, body: { error: 'Sesión no válida.' }, actorId: '' };
  }

  const { data: resolved, error: resolveError } = sessionId
    ? await admin.rpc('resolve_staff_session', {
        p_session_id: sessionId,
        p_auth_user_id: userData.user.id,
      })
    : { data: null, error: null };
  if (resolveError) throw resolveError;

  const decision = evaluateAdminSession({ sessionId, resolved });
  if (!decision.ok) {
    return { ok: false as const, status: decision.status, body: { error: decision.error }, actorId: '' };
  }
  return { ok: true as const, status: 200, body: {}, actorId: decision.staffId as string };
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

    const input = parseInput(body);
    if (typeof input === 'string') return json({ error: input }, 400);

    return await startTestCall(admin, auth.actorId, input);
  } catch (error) {
    console.error('ai-outbound-test-call failed', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'No se pudo completar la operación. Intente de nuevo.' }, 500);
  }
});
