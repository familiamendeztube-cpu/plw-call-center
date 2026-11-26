// Twilio webhook handlers for the US SMS flow: delivery status and inbound replies.
// STOP/unsubscribe marks the lead sms_consent=false (suppression); HELP gets a short reply.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const STOP_PATTERNS = /^(stop|stopall|unsubscribe|cancel|end|quit|baja|deténgase|detengase|no más|nomas)\b/i;
const HELP_PATTERNS = /^(help|ayuda|info)\b/i;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function handleStatusCallback(db: SupabaseClient, params: Record<string, string>) {
  const sid = params.MessageSid ?? params.SmsSid ?? '';
  const status = String(params.MessageStatus ?? '').toLowerCase();
  if (!sid || !status) return reply({ ok: false }, 400);
  const mapped = status === 'delivered' ? 'delivered' : status === 'undelivered' || status === 'failed' ? 'failed' : null;
  if (!mapped) return reply({ ok: true });
  const update: Record<string, unknown> = { status: mapped };
  if (mapped === 'failed') update.error = String(params.ErrorMessage ?? params.ErrorCode ?? '').slice(0, 300);
  const { error } = await db.from('us_sms_messages').update(update).eq('provider_sid', sid);
  if (error) throw error;
  return reply({ ok: true });
}

export async function handleInboundReply(db: SupabaseClient, params: Record<string, string>) {
  const from = String(params.From ?? '').replace(/\s+/g, '');
  const body = String(params.Body ?? '').slice(0, 500);
  if (!/^\+1[2-9][0-9]{9}$/.test(from)) return reply({ ok: true });
  const suppressed = STOP_PATTERNS.test(body.trim());
  const { data: leads, error } = await db
    .from('us_leads')
    .select('id')
    .or(`phone_e164.eq.${from},sms_mobile.eq.${from}`);
  if (error) throw error;
  const { error: inboundError } = await db.from('us_sms_inbound').insert({
    lead_id: leads?.[0]?.id ?? null,
    from_e164: from,
    body,
    suppressed,
  });
  if (inboundError) throw inboundError;
  // Every lead with this number stops getting SMS, not just the first match.
  if (suppressed && leads?.length) {
    const { error: stopError } = await db
      .from('us_leads')
      .update({ sms_consent: false, updated_at: new Date().toISOString() })
      .in('id', leads.map((lead) => lead.id));
    if (stopError) throw stopError;
  }
  if (HELP_PATTERNS.test(body.trim())) {
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
    const { data: settings } = await db
      .from('us_market_settings')
      .select('messaging_service_sid')
      .eq('id', 1)
      .maybeSingle();
    if (accountSid && authToken && settings?.messaging_service_sid) {
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: from,
          MessagingServiceSid: settings.messaging_service_sid,
          Body: 'Professional Latino Workers: recepción virtual para su negocio. Responda STOP para no recibir más mensajes.',
        }).toString(),
        signal: AbortSignal.timeout(15000),
      }).catch(() => {});
    }
  }
  return reply({ ok: true });
}
