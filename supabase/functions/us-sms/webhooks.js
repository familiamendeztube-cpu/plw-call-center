// Twilio webhook handlers for the US SMS flow: delivery status and inbound replies.
// STOP/unsubscribe marks the lead sms_consent=false (suppression); HELP gets a short reply.

async function checked(query: any) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

const STOP_PATTERNS = /^(stop|stopall|unsubscribe|cancel|end|quit|baja|deténgase|detengase|no más|nomas)\b/i;
const HELP_PATTERNS = /^(help|ayuda|info)\b/i;

export async function handleStatusCallback(db: any, params: Record<string, string>) {
  const sid = params.MessageSid ?? params.SmsSid ?? '';
  const status = String(params.MessageStatus ?? '').toLowerCase();
  if (!sid || !status) return new Response(JSON.stringify({ ok: false }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
  const mapped = status === 'delivered' ? 'delivered' : status === 'undelivered' ? 'failed' : null;
  if (!mapped) return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
  const update: Record<string, unknown> = { status: mapped };
  if (mapped === 'failed') update.error = String(params.ErrorMessage ?? '').slice(0, 300);
  await checked(db.from('us_sms_messages').update(update).eq('provider_sid', sid));
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleInboundReply(db: any, params: Record<string, string>) {
  const from = String(params.From ?? '').replace(/\s+/g, '');
  const body = String(params.Body ?? '').slice(0, 500);
  if (!/^\+1[2-9][0-9]{9}$/.test(from))
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  const suppressed = STOP_PATTERNS.test(body.trim());
  const { data: lead } = await checked(
    db.from('us_leads').select('id,sms_consent')
      .or(`phone_e164.eq.${from},sms_mobile.eq.${from}`)
      .limit(1)
      .maybeSingle()
  );
  await checked(
    db.from('us_sms_inbound').insert({
      lead_id: lead?.id ?? null,
      from_e164: from,
      body,
      suppressed,
    })
  );
  if (suppressed && lead?.id) {
    await checked(
      db.from('us_leads').update({ sms_consent: false, updated_at: new Date().toISOString() }).eq('id', lead.id)
    );
  }
  if (HELP_PATTERNS.test(body.trim())) {
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
    const { data: settings } = await checked(
      db.from('us_market_settings').select('messaging_service_sid').eq('id', 1).maybeSingle()
    );
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
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
