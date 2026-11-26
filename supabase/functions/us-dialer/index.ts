import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeAdmin } from './auth.ts';
import { runUsTick, dispatchUsCall, syncUsCalls, reconcileUsStuckCalls } from './runner.js';
import { normalizeUsPhone, providerRequest, sanitizeProviderError, usAgentConfig, usConfigFailures } from './provider.js';

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

    if (input.action === 'configure') {
      // The US number gates Iniciar and test calls (it means the US trunk exists).
      const caller = input.callerNumber ? normalizeUsPhone(input.callerNumber) : null;
      if (input.callerNumber && !caller)
        return json({ error: 'Revise el número de EE. UU.: 10 dígitos con área, con o sin el 1 inicial.' }, 400);
      const runtime = await db.from('us_dialer_runtime').select('*').eq('id', 1).maybeSingle();
      if (!runtime.data) return json({ error: 'Falta la tabla del marcador de EE. UU.' }, 409);
      const keepPause = (message: string) =>
        runtime.data.last_error === 'scheduler_paused' ? 'scheduler_paused' : message;
      const { data: settings, error } = await db
        .from('ai_outbound_settings')
        .select('voice_id,caller_phone_number_id')
        .eq('id', 1)
        .single();
      if (error || !settings?.voice_id || !settings?.caller_phone_number_id)
        return json({ error: 'Falta configurar la voz y línea de salida.' }, 409);
      const { data: sip, error: sipError } = await db
        .from('agent_sip_accounts')
        .select('sip_username,sip_domain')
        .eq('staff_id', 'agent-2')
        .maybeSingle();
      if (sipError || !sip) return json({ error: 'Falta el teléfono del agente receptor.' }, 409);
      const route = {
        transfer_uri: `sip:${sip.sip_username}@${sip.sip_domain}`,
        provider_agent_id: runtime.data.provider_agent_id,
      };
      const voiceId = settings.voice_id;
      let providerId = runtime.data.provider_agent_id;
      if (!providerId) {
        const created = await providerRequest(
          apiKey,
          '/agents/create',
          usAgentConfig('Alejandro', route, voiceId)
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
          usAgentConfig('Alejandro', route, voiceId),
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
          transfer_uri: route.transfer_uri,
          last_error: keepPause(''),
          ...(caller ? { caller_e164: caller } : {}),
        })
        .eq('id', 1);
      if (verifyError) throw verifyError;
      // Creates the US tick (cron) and marks the scheduler ready; calling stays paused until
      // the admin presses Iniciar.
      const { error: cronError } = await db.rpc('enable_us_scheduler');
      if (cronError) throw cronError;
      return json({ ok: true });
    }

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
