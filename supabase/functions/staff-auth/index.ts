import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const STAFF_ID_PATTERN = /^(agent-[0-9]+|admin-[0-9]+)$/;
const PIN_PATTERN = /^[0-9]{4}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

function bearerToken(req: Request) {
  const header = req.headers.get('Authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function isString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

async function handleLogin(body: Record<string, unknown>) {
  const { staffId, kind, secret, deviceToken } = body;
  if (!isString(staffId, 1, 40) || !STAFF_ID_PATTERN.test(staffId)) {
    return json({ status: 'invalid' }, 400);
  }
  if (kind !== 'pin' && kind !== 'passcode') return json({ status: 'invalid' }, 400);
  if (!isString(secret, 1, 200)) return json({ status: 'invalid' }, 400);
  if (kind === 'pin' && !PIN_PATTERN.test(secret)) return json({ status: 'invalid' }, 400);
  if (!isString(deviceToken, 16, 200)) return json({ status: 'device_required' }, 200);

  const admin = serviceClient();
  const { data, error } = await admin.rpc('staff_login', {
    p_kind: kind,
    p_staff_id: staffId,
    p_secret: secret,
    p_device_token: deviceToken,
  });
  if (error) throw error;

  const result = data as {
    status: string;
    auth_user_id?: string | null;
    role?: string;
    display_name?: string;
  };

  if (result.status !== 'ok') {
    return json({ status: result.status === 'device_required' ? 'device_required' : 'denied' }, 200);
  }

  const email = `${staffId}@staff.plw-callcenter.example`;
  let authUserId = result.auth_user_id ?? null;
  const password = randomPassword();

  if (!authUserId) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
    });
    if (createError || !created.user) throw createError ?? new Error('No se pudo crear la cuenta.');
    authUserId = created.user.id;
    const { error: linkError } = await admin.rpc('link_staff_auth_user', {
      p_staff_id: staffId,
      p_auth_user_id: authUserId,
    });
    if (linkError) throw linkError;
  } else {
    const { error: passwordError } = await admin.auth.admin.updateUserById(authUserId, { password });
    if (passwordError) throw passwordError;
  }

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw signInError ?? new Error('Sesión no disponible.');

  return json({
    status: 'ok',
    session: {
      accessToken: signIn.session.access_token,
      refreshToken: signIn.session.refresh_token,
      expiresAt: signIn.session.expires_at ?? null,
    },
    staff: {
      id: staffId,
      role: result.role,
      displayName: result.display_name ?? '',
    },
  });
}

async function handleEnrollDevice(body: Record<string, unknown>) {
  const { code, label, deviceToken } = body;
  if (!isString(code, 4, 40) || !isString(label, 1, 80) || !isString(deviceToken, 16, 200)) {
    return json({ status: 'invalid' }, 400);
  }
  const { data, error } = await serviceClient().rpc('enroll_office_device', {
    p_code: code,
    p_label: label.trim(),
    p_token: deviceToken,
  });
  if (error) throw error;
  const status = (data as { status: string }).status === 'ok' ? 'ok' : 'invalid';
  return json({ status }, status === 'ok' ? 200 : 400);
}

async function handleLogout(req: Request) {
  const jwt = bearerToken(req);
  if (!jwt) return json({ status: 'ok' });

  const admin = serviceClient();
  const { data: userData } = await admin.auth.getUser(jwt);
  if (userData.user) {
    const { data: staff } = await admin
      .from('staff_profiles')
      .select('id')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle();
    if (staff) {
      const { error } = await admin
        .from('staff_presence')
        .update({ availability: 'paused', updated_at: new Date().toISOString() })
        .eq('staff_id', staff.id);
      if (error) throw error;
    }
  }
  await admin.auth.admin.signOut(jwt, 'local');
  return json({ status: 'ok' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== 'POST') return json({ status: 'invalid' }, 405);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return json({ status: 'invalid' }, 400);

    switch (body.action) {
      case 'login':
        return await handleLogin(body);
      case 'enroll_device':
        return await handleEnrollDevice(body);
      case 'logout':
        return await handleLogout(req);
      default:
        return json({ status: 'invalid' }, 400);
    }
  } catch (error) {
    console.error('staff-auth failed', error instanceof Error ? error.message : 'unknown error');
    return json({ status: 'error', message: 'No se pudo completar la operación. Intente de nuevo.' }, 500);
  }
});
