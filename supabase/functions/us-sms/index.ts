// US SMS on Telnyx, from the same US number Anna calls from (us_dialer_runtime.caller_e164).
// Sends are registered first through us_sms_send (idempotent, consent-gated); Telnyx's
// delivery and reply webhooks arrive here signed with Ed25519. Secrets: TELNYX_API_KEY and
// TELNYX_PUBLIC_KEY, only in the function's environment. Never WhatsApp in the US flow.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeAdmin } from './auth.ts';
import { handleTelnyxEvent, sendTelnyxSms, verifyTelnyxSignature } from './telnyx.js';

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

// Also the URL to set as the webhook of the Telnyx messaging profile (for replies).
const WEBHOOK_URL = `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/us-sms?telnyx=1`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  try {
    const db = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    if (new URL(req.url).searchParams.get('telnyx') === '1') {
      const raw = await req.text();
      const valid = await verifyTelnyxSignature(
        raw,
        req.headers.get('telnyx-signature-ed25519'),
        req.headers.get('telnyx-timestamp'),
        Deno.env.get('TELNYX_PUBLIC_KEY') ?? ''
      );
      if (!valid) return json({ error: 'Firma no válida.' }, 401);
      let event: unknown;
      try {
        event = JSON.parse(raw);
      } catch {
        return json({ error: 'Cuerpo no válido.' }, 400);
      }
      await handleTelnyxEvent(db, event);
      return json({ ok: true });
    }

    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
    const auth = await authorizeAdmin({ admin: db, jwt });
    if (!auth.ok) return json(auth.body, auth.status);
    const input = await req.json();

    if (input.action === 'send') {
      const apiKey = Deno.env.get('TELNYX_API_KEY') ?? '';
      const { data: runtime } = await db.from('us_dialer_runtime').select('caller_e164').eq('id', 1).maybeSingle();
      const from: string = runtime?.caller_e164 ?? '';
      if (!apiKey || !from)
        return json({ error: 'Falta configurar Telnyx: la clave en el servidor o el número de EE. UU. en el marcador.' }, 503);
      if (!input.leadId || !input.body || !input.idempotencyKey)
        return json({ error: 'Faltan datos del mensaje.' }, 400);
      const body = String(input.body).slice(0, 800);
      // Register first: idempotent, consent/suppression evaluated in the database.
      const { data: reg, error: regError } = await db.rpc('us_sms_send', {
        p_lead_id: input.leadId,
        p_idempotency_key: String(input.idempotencyKey).slice(0, 120),
        p_body: body,
        p_web_url: String(input.webUrl ?? '').slice(0, 300),
        p_secretary_url: String(input.secretaryUrl ?? '').slice(0, 300),
        p_sender_id: from,
      });
      if (regError || !reg)
        return json({ error: `No se pudo registrar el SMS${regError?.message ? `: ${regError.message.slice(0, 160)}` : '.'}` }, 409);
      if (reg.status !== 'queued' || reg.reused)
        return json({ ok: true, id: reg.id, status: reg.status, reused: reg.reused ?? true });

      const sent = await sendTelnyxSms({ apiKey, from, to: reg.to_e164, text: body, webhookUrl: WEBHOOK_URL });
      if (!sent.ok) {
        await db
          .from('us_sms_messages')
          .update({ status: sent.optedOut ? 'suppressed' : 'failed', error: sent.error })
          .eq('id', reg.id);
        if (sent.optedOut) {
          await db.from('us_leads').update({ sms_consent: false, updated_at: new Date().toISOString() }).eq('id', input.leadId);
          return json({ ok: true, id: reg.id, status: 'suppressed', reused: false });
        }
        return json({ error: `Telnyx rechazó el mensaje: ${sent.error}` }, 502);
      }
      await db.from('us_sms_messages').update({ status: 'sent', provider_message_id: sent.id }).eq('id', reg.id);
      return json({ ok: true, id: reg.id, status: 'sent' });
    }

    return json({ error: 'Acción no válida.' }, 400);
  } catch {
    return json({ error: 'No se pudo confirmar la operación. Revise el registro antes de repetir el envío.' }, 500);
  }
});
