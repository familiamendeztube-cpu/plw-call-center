// US SMS on Telnyx, from PLW's US number (us_dialer_runtime.caller_e164, +1 754-799-1065).
// - Telnyx webhooks (?telnyx=1, signed with Ed25519): delivery results, and customers' texts,
//   which land on the customer's SMS tab (record_sms_received).
// - reply (any agent): answers a customer who texted PLW first; register_sms_reply runs as the
//   agent and checks the rule and their access before anything is sent.
// - send (admin): the sample-link text to a dialer lead (us_sms_send), same rule.
// Secrets: TELNYX_API_KEY and TELNYX_PUBLIC_KEY, only in the function's environment.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeStaff } from './auth.js';
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
const NOT_CONFIGURED = 'Falta configurar Telnyx: la clave en el servidor o el número de EE. UU. en el marcador.';

type Db = ReturnType<typeof createClient>;

/** The key and the US number to send from, or null while Telnyx is not set up. */
async function sender(db: Db): Promise<{ apiKey: string; from: string } | null> {
  const apiKey = Deno.env.get('TELNYX_API_KEY') ?? '';
  const { data: runtime } = await db.from('us_dialer_runtime').select('caller_e164').eq('id', 1).maybeSingle();
  const from: string = runtime?.caller_e164 ?? '';
  return apiKey && from ? { apiKey, from } : null;
}

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

    // Who is calling comes from the verified, unrevoked session only; the body is read after.
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
    const staff = await authorizeStaff({ admin: db, jwt });
    if (!staff) return json({ error: 'Sesión revocada o no válida.' }, 401);
    const input = await req.json().catch(() => null);
    if (typeof input !== 'object' || input === null) return json({ error: 'Solicitud no válida.' }, 400);

    if (input.action === 'reply') {
      const telnyx = await sender(db);
      if (!telnyx) return json({ error: NOT_CONFIGURED }, 503);
      // Runs as the agent: the database checks their access to the customer and the rule.
      const asAgent = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data: reg, error: regError } = await asAgent.rpc('register_sms_reply', {
        p_prospect_id: String(input.prospectId ?? ''),
        p_body: String(input.body ?? ''),
        p_idempotency_key: String(input.idempotencyKey ?? '').slice(0, 120),
      });
      if (regError || !reg) return json({ error: regError?.message?.slice(0, 200) || 'No se pudo registrar el mensaje.' }, 409);
      if (reg.reused || reg.status !== 'queued') return json({ ok: true, id: reg.id, status: reg.status });

      const sent = await sendTelnyxSms({
        apiKey: telnyx.apiKey,
        from: telnyx.from,
        to: reg.to,
        text: String(input.body).trim(),
        webhookUrl: WEBHOOK_URL,
      });
      const status = sent.ok ? 'sent' : sent.optedOut ? 'suppressed' : 'failed';
      await db
        .from('sms_messages')
        .update(sent.ok ? { status, provider_message_id: sent.id } : { status, error: sent.error })
        .eq('id', reg.id);
      if (!sent.ok && !sent.optedOut) return json({ error: `Telnyx no envió el mensaje: ${sent.error}` }, 502);
      if (sent.optedOut) return json({ error: 'El cliente pidió no recibir más mensajes (STOP).' }, 409);
      return json({ ok: true, id: reg.id, status });
    }

    if (input.action === 'send') {
      if (staff.role !== 'admin') return json({ error: 'No autorizado.' }, 403);
      const telnyx = await sender(db);
      if (!telnyx) return json({ error: NOT_CONFIGURED }, 503);
      if (!input.leadId || !input.body || !input.idempotencyKey)
        return json({ error: 'Faltan datos del mensaje.' }, 400);
      const body = String(input.body).slice(0, 800);
      // Register first: idempotent; the rule (the number texted PLW first) is checked in the database.
      const { data: reg, error: regError } = await db.rpc('us_sms_send', {
        p_lead_id: input.leadId,
        p_idempotency_key: String(input.idempotencyKey).slice(0, 120),
        p_body: body,
        p_web_url: String(input.webUrl ?? '').slice(0, 300),
        p_secretary_url: String(input.secretaryUrl ?? '').slice(0, 300),
        p_sender_id: telnyx.from,
      });
      if (regError || !reg)
        return json({ error: `No se pudo registrar el SMS${regError?.message ? `: ${regError.message.slice(0, 160)}` : '.'}` }, 409);
      if (reg.status !== 'queued' || reg.reused)
        return json({ ok: true, id: reg.id, status: reg.status, reused: reg.reused ?? true });

      const sent = await sendTelnyxSms({ apiKey: telnyx.apiKey, from: telnyx.from, to: reg.to_e164, text: body, webhookUrl: WEBHOOK_URL });
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
