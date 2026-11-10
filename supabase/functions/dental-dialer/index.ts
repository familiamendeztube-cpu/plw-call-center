import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeAdmin } from './auth.ts';
import { runTick, dispatchCall, syncCalls } from './runner.js';
import { providerRequest, safeAgent, dentalAgentConfig } from './provider.js';
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
      await runTick(db, apiKey);
      return json({ ok: true });
    }
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
    const auth = await authorizeAdmin({ admin: db, jwt });
    if (!auth.ok) return json(auth.body, auth.status);
    const input = await req.json();
    if (!apiKey) return json({ error: 'Falta configurar ElevenLabs.' }, 503);
    if (input.action === 'sync') {
      await syncCalls(db, apiKey);
      return json({ ok: true });
    }
    if (!['agent-2', 'agent-3'].includes(input.staffId))
      return json({ error: 'Agente no válido.' }, 400);
    const { data: route, error: routeError } = await db
      .from('dental_agent_dialers')
      .select('*')
      .eq('staff_id', input.staffId)
      .single();
    if (routeError || !route) return json({ error: 'Falta la ruta telefónica del agente.' }, 409);
    if (input.action === 'configure') {
      if (route.state === 'running')
        return json({ error: 'Pause el agente antes de configurarlo.' }, 409);
      const { data: settings, error } = await db
        .from('ai_outbound_settings')
        .select('voice_id,caller_phone_number_id')
        .eq('id', 1)
        .single();
      if (error || !settings?.voice_id || !settings?.caller_phone_number_id)
        return json({ error: 'Falta configurar la voz y línea de salida.' }, 409);
      let providerId = route.provider_agent_id;
      if (!providerId) {
        const { data: lock, error: lockError } = await db
          .from('dental_agent_dialers')
          .update({ last_error: 'Configurando proveedor; no repetir sin verificar.' })
          .eq('staff_id', input.staffId)
          .is('provider_agent_id', null)
          .eq('last_error', '')
          .select('staff_id');
        if (lockError || !lock?.length)
          return json({ error: 'La configuración requiere revisar el intento anterior.' }, 409);
        const created = await providerRequest(
          apiKey,
          '/agents/create',
          dentalAgentConfig(
            input.staffId === 'agent-2' ? 'Alejandro' : 'Valeska',
            route,
            settings.voice_id
          )
        );
        providerId = created.data?.agent_id;
        if (!created.ok || typeof providerId !== 'string')
          return json(
            { error: 'No se confirmó la creación de la voz. Revise ElevenLabs antes de repetir.' },
            502
          );
        const { error: saveError } = await db
          .from('dental_agent_dialers')
          .update({
            provider_agent_id: providerId,
            voice_id: settings.voice_id,
            caller_phone_number_id: settings.caller_phone_number_id,
          })
          .eq('staff_id', input.staffId);
        if (saveError) throw saveError;
      }
      const response = await providerRequest(
        apiKey,
        `/agents/${encodeURIComponent(providerId)}`,
        undefined
      );
      if (!response.ok || !safeAgent(response.data, { ...route, provider_agent_id: providerId }))
        return json({ error: 'La configuración de transferencia no pasó la verificación.' }, 409);
      const { error: verifyError } = await db
        .from('dental_agent_dialers')
        .update({ config_verified_at: new Date().toISOString(), last_error: '' })
        .eq('staff_id', input.staffId);
      if (verifyError) throw verifyError;
      const { error: cronError } = await db.rpc('enable_dental_scheduler');
      if (cronError) throw cronError;
      return json({ ok: true });
    }
    if (input.action === 'test') {
      const phone = String(input.phone ?? '')
        .replace(/\D/g, '')
        .replace(/^506(?=\d{8}$)/, '');
      if (
        !/^[2-8]\d{7}$/.test(phone) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          input.requestId ?? ''
        )
      )
        return json({ error: 'Revise el teléfono y la solicitud.' }, 400);
      const cfg = await providerRequest(
        apiKey,
        `/agents/${encodeURIComponent(route.provider_agent_id)}`,
        undefined
      );
      if (!cfg.ok || !safeAgent(cfg.data, route))
        return json({ error: 'Primero configure y verifique la voz.' }, 409);
      const { data: claim, error } = await db.rpc('reserve_dental_test', {
        p_id: input.requestId,
        p_staff_id: input.staffId,
        p_phone: phone,
      });
      if (error)
        return json(
          { error: 'No se pudo reservar la prueba. Revise llamadas activas y números bloqueados.' },
          409
        );
      if (claim.claimed) await dispatchCall(db, apiKey, claim);
      return json({ ok: true, id: claim.call.id });
    }
    return json({ error: 'Acción no válida.' }, 400);
  } catch {
    return json(
      { error: 'No se pudo confirmar la operación. Revise el registro antes de repetir llamadas.' },
      500
    );
  }
});
