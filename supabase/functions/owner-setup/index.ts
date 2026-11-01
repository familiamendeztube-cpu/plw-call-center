import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const INITIAL_PASSCODE = Deno.env.get('PLW_OWNER_INITIAL_PASSCODE') ?? '';

const PASSCODE_MIN = 12;
const PASSCODE_MAX = 200;
const LABEL_MAX = 80;
const DEVICE_TOKEN_MIN = 16;
const DEVICE_TOKEN_MAX = 200;

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

function isString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

async function sha256(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

function sha256Hex(text: string): Promise<string> {
  return sha256(text).then((bytes) =>
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  );
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

async function passcodeMatches(candidate: string): Promise<boolean> {
  const [candidateDigest, expectedDigest] = await Promise.all([
    sha256(candidate),
    sha256(INITIAL_PASSCODE),
  ]);
  return sameBytes(candidateDigest, expectedDigest);
}

async function handleStatus() {
  const { data, error } = await serviceClient().rpc('owner_setup_status');
  if (error) throw error;
  const setupComplete = data === true;
  return json({
    status: 'ok',
    setupComplete,
    setupAvailable: !setupComplete && INITIAL_PASSCODE.length > 0,
  });
}

async function handleSetup(body: Record<string, unknown>) {
  const { passcode, computerName, deviceToken } = body;
  if (!isString(passcode, PASSCODE_MIN, PASSCODE_MAX)) {
    return json({ status: 'invalid' }, 400);
  }
  if (!isString(computerName, 1, LABEL_MAX) || !isString(deviceToken, DEVICE_TOKEN_MIN, DEVICE_TOKEN_MAX)) {
    return json({ status: 'invalid' }, 400);
  }
  if (INITIAL_PASSCODE.length === 0) {
    return json({ status: 'unavailable' }, 503);
  }

  const admin = serviceClient();
  const { data: complete, error: statusError } = await admin.rpc('owner_setup_status');
  if (statusError) throw statusError;
  if (complete === true) return json({ status: 'already_completed' }, 409);

  const { data: throttled, error: throttleError } = await admin.rpc('owner_setup_is_throttled');
  if (throttleError) throw throttleError;
  if (throttled === true) return json({ status: 'throttled' }, 429);

  if (!(await passcodeMatches(passcode))) {
    const { error: recordError } = await admin.rpc('owner_setup_record_failure');
    if (recordError) throw recordError;
    return json({ status: 'invalid' }, 403);
  }

  const { data, error } = await admin.rpc('owner_initial_setup', {
    p_passcode: passcode,
    p_device_token_hash: await sha256Hex(deviceToken),
    p_label: computerName.trim(),
  });
  if (error) throw error;

  const status = (data as { status?: string } | null)?.status;
  if (status === 'already_completed') return json({ status }, 409);
  if (status !== 'ok') return json({ status: 'error' }, 500);
  return json({ status: 'ok' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== 'POST') return json({ status: 'invalid' }, 405);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return json({ status: 'invalid' }, 400);

    switch (body.action) {
      case 'status':
        return await handleStatus();
      case 'setup':
        return await handleSetup(body);
      default:
        return json({ status: 'invalid' }, 400);
    }
  } catch (error) {
    console.error('owner-setup failed', error instanceof Error ? error.message : 'unknown error');
    return json({ status: 'error', message: 'No se pudo completar la operación. Intente de nuevo.' }, 500);
  }
});
