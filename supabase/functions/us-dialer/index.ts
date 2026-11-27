import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeAdmin } from './auth.ts';
import { runUsTick, dispatchUsCall, syncUsCalls, reconcileUsStuckCalls } from './runner.js';
import { assignUsReception, ensureUsReception, usNumberAgent } from './reception.js';
import {
  findPhoneNumberId,
  normalizeUsPhone,
  providerRequest,
  sanitizeProviderError,
  usAgentConfig,
  usConfigFailures,
} from './provider.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Apikey, X-Client-Info',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  try {
    const db = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const apiKey = Deno.env.get('ELEVENLABS_API_KEY') ?? '';
    const runnerKey = req.headers.get('X-PLW-Runner');
    if (runnerKey) {
      // Same runner key as the other dialers: the campaign cron carries it; never a browser.
      const { data: valid, error } = await db.rpc('dental_runner_key_valid', { p_key: runnerKey });
      if (error || valid !== true) return json({ error: 'No autorizado.' }, 401);
      if (!apiKey) return json({ error: 'Falta configurar ElevenLabs.' }, 503);
      const body = await req.json().catch(() => null);
      // Creates or updates PLW USA — Recepción. Only the server holds the runner key (in Vault).
      if (body?.action === 'reception') return json(await ensureUsReception(db, apiKey));
      if (body?.action === 'number_agent') return json(await usNumberAgent(db, apiKey));
      if (body?.action === 'assign_reception') return json(await assignUsReception(db, apiKey));
      if (body?.action === 'configure') return await configureUs(db, apiKey, body.callerNumber);
      if (body?.action === 'voices') return json(await usVoices(db, apiKey));
      await runUsTick(db, apiKey);
      return json({ ok: true });
    }
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
    const auth = await authorizeAdmin({ admin: db, jwt });
    if (!auth.ok) return json(auth.body, auth.status);
    const input = await req.json();
    if (!apiKey) return json({ error: 'Falta configurar ElevenLabs.' }, 503);
    // Admin-gated RPCs (control, test reservation) verify is_admin() from the caller's JWT.
    // They must run as the administrator, not with the service-role key.
    const userDb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      }
    );

    if (input.action === 'sync') {
      await syncUsCalls(db, apiKey);
      await reconcileUsStuckCalls(db, apiKey).catch(() => {});
      return json({ ok: true });
    }

    if (input.action === 'configure') return await configureUs(db, apiKey, input.callerNumber);

    if (input.action === 'control') {
      if (!['start', 'pause'].includes(input.state))
        return json({ error: 'Acción no válida.' }, 400);
      const { error } = await userDb.rpc('control_us_dialer', { p_action: input.state });
      if (error)
        return json({ error: error.message || 'No se pudo cambiar el estado. Revise el latido del servidor.' }, 409);
      return json({ ok: true });
    }

    if (input.action === 'test') {
      const phone = normalizeUsPhone(input.phone);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId ?? ''))
        return json({ error: 'Solicitud de prueba no válida: vuelva a abrir la tarjeta e inténtelo de nuevo.' }, 400);
      if (!phone)
        return json({ error: 'Revise el teléfono: use un número de EE. UU. de 10 dígitos con área, con o sin el 1 inicial.' }, 400);
      const runtime = await db.from('us_dialer_runtime').select('*').eq('id', 1).maybeSingle();
      if (!runtime.data?.provider_agent_id || !runtime.data?.config_verified_at)
        return json({ error: 'Primero configure y verifique la voz.' }, 409);
      const { data: claim, error } = await userDb.rpc('reserve_us_test', {
        p_id: input.requestId,
        p_phone: phone,
      });
      if (error || !claim)
        return json({ error: `No se pudo reservar la prueba${error?.message ? `: ${error.message.slice(0, 200)}` : '.'}` }, 409);
      if (claim.claimed) await dispatchUsCall(db, apiKey, claim);
      return json({ ok: true, id: claim.call.id });
    }

    return json({ error: 'Acción no válida.' }, 400);
  } catch {
    return json({ error: 'No se pudo confirmar la operación. Revise el registro antes de repetir llamadas.' }, 500);
  }
});

/** Read-only: languages and voices of Anna and PLW USA — Recepción, and the Melissa/Siren voice ids. */
async function usVoices(db: ReturnType<typeof createClient>, apiKey: string) {
  const { data: runtime } = await db.from('us_dialer_runtime').select('provider_agent_id').eq('id', 1).maybeSingle();
  const { data: row } = await db.from('settings').select('value').eq('key', 'us_reception_agent').maybeSingle();
  const agents: Record<string, unknown> = {};
  for (const [label, id] of [['anna', runtime?.provider_agent_id], ['reception', row?.value?.agent_id]]) {
    if (typeof id !== 'string') continue;
    const c = (await providerRequest(apiKey, `/agents/${encodeURIComponent(id)}`)).data?.conversation_config ?? {};
    agents[label] = {
      language: c.agent?.language ?? null,
      llm: c.agent?.prompt?.llm ?? null,
      presets: Object.fromEntries(Object.entries(c.language_presets ?? {}).map(([lang, p]: [string, any]) => [lang, p?.overrides?.tts ?? null])),
      tts: { voice_id: c.tts?.voice_id ?? null, model_id: c.tts?.model_id ?? null, supported_voices: c.tts?.supported_voices ?? null },
    };
  }
  const found: unknown[] = [];
  for (const name of ['Melissa', 'Siren']) {
    const r = await fetch(`https://api.elevenlabs.io/v2/voices?search=${name}&page_size=10`, { headers: { 'xi-api-key': apiKey } });
    const voices = r.ok ? (await r.json()).voices ?? [] : [];
    found.push(...voices.map((v: any) => ({ voice_id: v.voice_id, name: v.name })));
  }
  return { agents, voices: found };
}

/**
 * Configurar Anna EE. UU.: creates or re-checks Anna's US agent in ElevenLabs, saves the US number,
 * its ElevenLabs id and Alejandro's transfer address, and turns the US tick on. Calling stays
 * paused until an admin presses Iniciar. Used by the admin card and by the server (runner key).
 */
async function configureUs(
  db: ReturnType<typeof createClient>,
  apiKey: string,
  callerNumber: unknown
): Promise<Response> {
  // The US number gates Iniciar and test calls (it means the US trunk exists).
  const caller = callerNumber ? normalizeUsPhone(callerNumber) : null;
  if (callerNumber && !caller)
    return json({ error: 'Revise el número de EE. UU.: 10 dígitos con área, con o sin el 1 inicial.' }, 400);
  const runtime = await db.from('us_dialer_runtime').select('*').eq('id', 1).maybeSingle();
  if (!runtime.data) return json({ error: 'Falta la tabla del marcador de EE. UU.' }, 409);
  const keepPause = (message: string) =>
    runtime.data.last_error === 'scheduler_paused' ? 'scheduler_paused' : message;
  // US calls go out on the Telnyx number imported in ElevenLabs, never on the Costa Rica line. Without a number the voice is still verified, but Iniciar and
  // test calls stay blocked.
  const usNumber: string | null = caller ?? runtime.data.caller_e164;
  let phoneNumberId: string | null = null;
  if (usNumber) {
    const numbers = await providerRequest(apiKey, '/phone-numbers');
    phoneNumberId = numbers.ok ? findPhoneNumberId(numbers.data, usNumber) : null;
    if (!phoneNumberId)
      return json({
        error: `El número ${usNumber} no aparece en ElevenLabs. Impórtelo en ElevenLabs (Phone Numbers) y presione Configurar de nuevo.`,
      }, 409);
  }
  // Anna's voices are fixed in usScript.js (Melissa in Spanish, Siren in English). Since
  // 2026-11-27 Anna never transfers: no route is stored, and the agent config has no
  // transfer_to_number tool.
  if (!usNumber) return json({ error: 'Escriba el número de EE. UU. y presione Configurar.' }, 409);
  const route = {
    provider_agent_id: runtime.data.provider_agent_id,
  };
  let providerId = runtime.data.provider_agent_id;
  if (!providerId) {
    const created = await providerRequest(
      apiKey,
      '/agents/create',
      usAgentConfig('Alejandro', route)
    );
    providerId = created.data?.agent_id;
    if (!created.ok || typeof providerId !== 'string')
      return json({ error: 'No se confirmó la creación de la voz. Revise ElevenLabs antes de repetir.' }, 502);
    await db.from('us_dialer_runtime').update({ provider_agent_id: providerId }).eq('id', 1);
  }
  route.provider_agent_id = providerId;
  let failures = usConfigFailures(
    (await providerRequest(apiKey, `/agents/${encodeURIComponent(providerId)}`)).data ?? {},
    route
  );
  if (failures.length && !failures.includes('provider_read')) {
    const patched = await providerRequest(
      apiKey,
      `/agents/${encodeURIComponent(providerId)}`,
      usAgentConfig('Alejandro', route),
      fetch,
      'PATCH'
    );
    if (!patched.ok) {
      const detail = JSON.stringify(sanitizeProviderError(patched.data)).slice(0, 300);
      await db
        .from('us_dialer_runtime')
        .update({ last_error: keepPause(`Verificación pendiente: ${failures.join(', ')}. ${detail}`) })
        .eq('id', 1);
      return json({ error: `La configuración no pasó la verificación. Motivo técnico: ${failures.join(', ')}. ${detail}` }, 409);
    }
    const reread = await providerRequest(apiKey, `/agents/${encodeURIComponent(providerId)}`);
    failures = usConfigFailures(reread.data ?? {}, route);
  }
  if (failures.length)
    return json({ error: `La configuración no pasó la verificación. Motivo técnico: ${failures.join(', ')}.` }, 409);
  const { error: verifyError } = await db
    .from('us_dialer_runtime')
    .update({
      config_verified_at: new Date().toISOString(),
      transfer_uri: null,
      last_error: keepPause(''),
      ...(usNumber ? { caller_e164: usNumber, phone_number_id: phoneNumberId } : {}),
    })
    .eq('id', 1);
  if (verifyError) throw verifyError;
  // Creates the US tick (cron) and marks the scheduler ready; calling stays paused until
  // the admin presses Iniciar.
  const { error: cronError } = await db.rpc('enable_us_scheduler');
  if (cronError) throw cronError;
  return json({ ok: true, provider_agent_id: providerId, phone_number_id: phoneNumberId, caller_e164: usNumber });
}
