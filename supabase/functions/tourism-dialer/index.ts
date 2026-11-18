import { createClient } from 'npm:@supabase/supabase-js@2';import { authorizeAdmin } from './auth.ts';
import { runTourismTick, dispatchTourismCall, syncTourismCalls, reconcileTourismStuckCalls } from './runner.js';
import {
  tourismAgentConfig,
  tourismConfigFailures,
} from './provider.js';
import { providerRequest, sanitizeProviderError } from './provider.js';

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
      const { data: valid, error } = await db.rpc('dental_runner_key_valid', { p_key: runnerKey });
      if (error || valid !== true) return json({ error: 'No autorizado.' }, 401);
      if (!apiKey) return json({ error: 'Falta configurar ElevenLabs.' }, 503);
      await runTourismTick(db, apiKey);
      return json({ ok: true });
    }
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
    const auth = await authorizeAdmin({ admin: db, jwt });
    if (!auth.ok) return json(auth.body, auth.status);
    const input = await req.json();
    if (!apiKey) return json({ error: 'Falta configurar ElevenLabs.' }, 503);

    if (input.action === 'sync') {
      await syncTourismCalls(db, apiKey);
      await reconcileTourismStuckCalls(db, apiKey).catch(() => {});
      return json({ ok: true });
    }

    if (input.action === 'configure') {
      const runtime = await db.from('tourism_dialer_runtime').select('*').eq('id', 1).maybeSingle();
      if (!runtime.data) return json({ error: 'Falta la tabla del marcador de turismo.' }, 409);
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
          tourismAgentConfig('Alejandro', route, voiceId)
        );
        providerId = created.data?.agent_id;
        if (!created.ok || typeof providerId !== 'string')
          return json({ error: 'No se confirmó la creación de la voz. Revise ElevenLabs antes de repetir.' }, 502);
        await db.from('tourism_dialer_runtime').update({ provider_agent_id: providerId }).eq('id', 1);
      }
      let failures = tourismConfigFailures(
        (await providerRequest(apiKey, `/agents/${encodeURIComponent(providerId)}`)).data ?? {},
        route
      );
      if (failures.length && !failures.includes('provider_read')) {
        const patched = await providerRequest(
          apiKey,
          `/agents/${encodeURIComponent(providerId)}`,
          tourismAgentConfig('Alejandro', route, voiceId),
          fetch,
          'PATCH'
        );
        if (!patched.ok) {
          const detail = JSON.stringify(sanitizeProviderError(patched.data)).slice(0, 300);
          await db
            .from('tourism_dialer_runtime')
            .update({ last_error: `Verificación pendiente: ${failures.join(', ')}. ${detail}` })
            .eq('id', 1);
          return json({ error: `La configuración no pasó la verificación. Motivo técnico: ${failures.join(', ')}. ${detail}` }, 409);
        }
        const reread = await providerRequest(apiKey, `/agents/${encodeURIComponent(providerId)}`);
        failures = tourismConfigFailures(reread.data ?? {}, route);
      }
      if (failures.length)
        return json({ error: `La configuración no pasó la verificación. Motivo técnico: ${failures.join(', ')}.` }, 409);
      const { error: verifyError } = await db
        .from('tourism_dialer_runtime')
        .update({
          config_verified_at: new Date().toISOString(),
          transfer_uri: route.transfer_uri,
          last_error: '',
        })
        .eq('id', 1);
      if (verifyError) throw verifyError;
      const { error: cronError } = await db.rpc('enable_tourism_scheduler');
      if (cronError) throw cronError;
      return json({ ok: true });
    }

    if (input.action === 'control') {
      if (!['start', 'pause'].includes(input.state))
        return json({ error: 'Acción no válida.' }, 400);
      const { error } = await db.rpc('control_tourism_dialer', { p_action: input.state });
      if (error)
        return json({ error: 'No se pudo cambiar el estado. Revise el latido del servidor.' }, 409);
      return json({ ok: true });
    }

    if (input.action === 'test') {
      const phone = String(input.phone ?? '').replace(/\D/g, '').replace(/^506(?=\d{8}$)/, '');
      if (!/^[2-8]\d{7}$/.test(phone) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId ?? ''))
        return json({ error: 'Revise el teléfono y la solicitud.' }, 400);
      const runtime = await db.from('tourism_dialer_runtime').select('*').eq('id', 1).maybeSingle();
      if (!runtime.data?.provider_agent_id || !runtime.data?.config_verified_at)
        return json({ error: 'Primero configure y verifique la voz.' }, 409);
      const { data: claim, error } = await db.rpc('reserve_tourism_test', {
        p_id: input.requestId,
        p_phone: phone,
      });
      if (error) return json({ error: 'No se pudo reservar la prueba.' }, 409);
      if (claim.claimed) await dispatchTourismCall(db, apiKey, claim);
      return json({ ok: true, id: claim.call.id });
    }

    return json({ error: 'Acción no válida.' }, 400);
  } catch {
    return json({ error: 'No se pudo confirmar la operación. Revise el registro antes de repetir llamadas.' }, 500);
  }
});
