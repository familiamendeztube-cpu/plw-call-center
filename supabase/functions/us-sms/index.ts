// US SMS via Twilio Messaging Service. Sends are registered through us_sms_send (idempotent,
// consent-gated) and delivered with the Messaging Service; status callbacks and inbound
// replies are Twilio-signed webhooks. STOP/HELP/unsubscribe suppresses the lead. Never
// WhatsApp in the US flow. Credentials only from Deno.env, never returned to the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeAdmin } from './auth.ts';
import { handleStatusCallback, handleInboundReply } from './webhooks.js';

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
  try {
    const url = new URL(req.url);
    // Twilio webhooks: application/x-www-form-urlencoded, signed with the auth token.
    if (url.searchParams.get('twilio') === '1') {
      const db = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
      const token = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
      return await handleWebhook(db, req, token);
    }

    if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
    const db = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
    const auth = await authorizeAdmin({ admin: db, jwt });
    if (!auth.ok) return json(auth.body, auth.status);
    const input = await req.json();

    if (input.action === 'settings') {
      const { data, error } = await db
        .from('us_market_settings')
        .update({
          messaging_service_sid: String(input.messaging_service_sid ?? '').slice(0, 40),
          sms_sender_id: String(input.sms_sender_id ?? '').slice(0, 20),
          sms_webhook_url: String(input.sms_webhook_url ?? '').slice(0, 300),
          status_webhook_url: String(input.status_webhook_url ?? '').slice(0, 300),
          public_base_url: String(input.public_base_url ?? '').slice(0, 300),
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1)
        .select('messaging_service_sid,sms_sender_id,sms_webhook_url,status_webhook_url,public_base_url')
        .single();
      if (error) return json({ error: 'No se pudo guardar la configuración de SMS.' }, 409);
      return json({ ok: true, settings: data });
    }

    if (input.action === 'send') {
      const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
      const authToken = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
      const { data: settings } = await db
        .from('us_market_settings')
        .select('messaging_service_sid,sms_sender_id')
        .eq('id', 1)
        .maybeSingle();
      const serviceSid = settings?.messaging_service_sid ?? '';
      if (!accountSid || !authToken || !serviceSid)
        return json({ error: 'Falta configurar Twilio (credenciales o Messaging Service SID) en el servidor.' }, 503);
      if (!input.leadId || !input.body || !input.idempotencyKey)
        return json({ error: 'Faltan datos del mensaje.' }, 400);
      // Register first: idempotent, consent/suppression evaluated in the database.
      const { data: reg, error: regError } = await db.rpc('us_sms_send', {
        p_lead_id: input.leadId,
        p_idempotency_key: String(input.idempotencyKey).slice(0, 120),
        p_body: String(input.body).slice(0, 800),
        p_web_url: String(input.webUrl ?? '').slice(0, 300),
        p_secretary_url: String(input.secretaryUrl ?? '').slice(0, 300),
        p_sender_id: settings?.sms_sender_id ?? '',
        p_service_sid: serviceSid,
      });
      if (regError || !reg)
        return json({ error: `No se pudo registrar el SMS${regError?.message ? `: ${regError.message.slice(0, 160)}` : '.'}` }, 409);
      if (reg.status !== 'queued' || reg.reused)
        return json({ ok: true, id: reg.id, status: reg.status, reused: reg.reused ?? true });
      const toNumber: string = reg.to_e164 ?? '';
      if (!/^\+1[2-9][0-9]{9}$/.test(toNumber))
        return json({ error: 'El móvil para SMS no es un número de EE. UU. válido.' }, 409);
      const form = new URLSearchParams({
        To: toNumber,
        MessagingServiceSid: serviceSid,
        Body: String(input.body).slice(0, 800),
        StatusCallback: settings?.status_webhook_url
          ? `${input.statusWebhookUrl ?? settings.status_webhook_url}${settings.status_webhook_url.includes('?') ? '&' : '?'}twilio=1&kind=status`
          : '',
      });
      const twResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        signal: AbortSignal.timeout(20000),
      });
      const twData = await twResp.json().catch(() => null);
      if (!twResp.ok) {
        const detail = String(twData?.message ?? '').slice(0, 280);
        await db.from('us_sms_messages').update({ status: 'failed', error: detail }).eq('id', reg.id);
        return json({ error: `Twilio rechazó el mensaje: ${detail || `HTTP ${twResp.status}`}` }, 502);
      }
      await db
        .from('us_sms_messages')
        .update({
          status: 'sent',
          provider_sid: typeof twData?.sid === 'string' ? twData.sid : null,
        })
        .eq('id', reg.id);
      return json({ ok: true, id: reg.id, status: 'sent' });
    }

    return json({ error: 'Acción no válida.' }, 400);
  } catch {
    return json({ error: 'No se pudo confirmar la operación. Revise el registro antes de repetir el envío.' }, 500);
  }
});

async function handleWebhook(db: any, req: Request, authToken: string) {
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') ?? '';
  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: 'Cuerpo no válido.' }, 400);
  // Twilio signature: HMAC-SHA1 over url + concatenated POST fields, base64.
  const signature = req.headers.get('X-Twilio-Signature') ?? '';
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries())
    if (typeof value === 'string') params[key] = value;
  const expected = await twilioSignature(url.toString(), params, authToken);
  if (!authToken || !signature || signature !== expected)
    return json({ error: 'Firma no válida.' }, 401);
  if (kind === 'status')
    return await handleStatusCallback(db, params);
  if (kind === 'inbound')
    return await handleInboundReply(db, params);
  return json({ error: 'Webhook desconocido.' }, 400);
}

async function twilioSignature(url: string, params: Record<string, string>, authToken: string) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
