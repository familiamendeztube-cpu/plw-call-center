// Tourism dispatcher runner: same proven mechanics as the dental runner (dispatch, sync,
// reconcile) against tourism tables, with tourism outcome mapping and exactly-once
// callback scheduling. Never touches dental rows.
import { providerReason } from './provider.js';
import {
  TOURISM_SCRIPT_VERSION,
  greetingFor,
} from './tourismScript.js';
import { tourismCallResults } from './provider.js';

const OUTBOUND_TIMEOUT_S = 45;
const STUCK_GIVE_UP_MS = 15 * 60_000;

async function checked(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function dispatchTourismCall(db, apiKey, claim, fetchImpl = fetch) {
  const { call, lead } = claim;
  const runtime = await checked(
    db.from('tourism_dialer_runtime').select('last_error,scheduler_ready,transfer_uri').eq('id', 1).maybeSingle()
  );
  if (!runtime?.scheduler_ready || runtime.last_error === 'scheduler_paused') {
    await checked(
      db
        .from('tourism_calls')
        .update({ state: 'cancelled', error: 'Marcador pausado antes del envío.', finished_at: new Date().toISOString() })
        .eq('id', call.id)
        .eq('state', 'reserved')
    );
    return;
  }
  const blocked = await checked(
    db.from('ai_outbound_do_not_call').select('phone').eq('phone', call.phone).maybeSingle()
  );
  if (blocked) {
    await checked(
      db
        .from('tourism_calls')
        .update({ state: 'cancelled', error: 'Número bloqueado.', finished_at: new Date().toISOString() })
        .eq('id', call.id)
    );
    return;
  }
  let result;
  const settings = await checked(
    db.from('ai_outbound_settings').select('caller_phone_number_id').eq('id', 1).maybeSingle()
  );
  if (!settings?.caller_phone_number_id || !runtime?.transfer_uri) {
    await checked(
      db
        .from('tourism_calls')
        .update({ state: 'cancelled', error: 'Falta la línea de salida o la ruta de transferencia.', finished_at: new Date().toISOString() })
        .eq('id', call.id)
        .eq('state', 'reserved')
    );
    return;
  }
  try {
    result = await fetchImpl('https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_S * 1000),
      body: JSON.stringify({
        agent_id: call.provider_agent_id,
        agent_phone_number_id: settings.caller_phone_number_id,
        to_number: `+506${call.phone}`,
        conversation_initiation_client_data: {
          dynamic_variables: {
            business_name: lead.business_name || 'el negocio de turismo',
            contact_name: lead.contact_name || 'la persona encargada de reservas o administración',
            saludo: greetingFor(),
            plw_tourism_call_id: call.id,
            plw_transfer_uri: runtime.transfer_uri,
            plw_script_version: TOURISM_SCRIPT_VERSION,
          },
        },
      }),
    });
    result = { ok: result.ok, status: result.status, data: await result.json().catch(() => null) };
  } catch {
    result = { ok: false, status: 0, data: null };
  }
  const id = result.data?.conversation_id;
  const accepted =
    result.ok && result.data?.success === true && typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
  const rejected = (result.status >= 400 && result.status < 500) || (result.ok && result.data?.success === false);
  const reason = accepted ? '' : providerReason(result, OUTBOUND_TIMEOUT_S);
  await checked(
    db
      .from('tourism_calls')
      .update(
        accepted
          ? { state: 'started', conversation_id: id }
          : {
              state: rejected ? 'failed' : 'uncertain',
              error: rejected
                ? `El proveedor rechazó la llamada${reason}.`
                : `Resultado sin confirmar${reason}. Se buscará la conversación; no se volverá a marcar.`,
              ...(rejected ? { finished_at: new Date().toISOString() } : {}),
            }
      )
      .eq('id', call.id)
      .eq('state', 'reserved')
  );
}

/** Confirmed day+time captures become exactly-once callbacks. */
async function scheduleCallback(db, call, details) {
  if (!details.callback_date || !details.callback_clock) return;
  const scheduled = new Date(`${details.callback_date}T${details.callback_clock}:00-06:00`);
  if (Number.isNaN(scheduled.getTime())) return;
  const { error } = await db
    .from('tourism_callbacks')
    .upsert(
      {
        call_id: call.id,
        lead_id: call.lead_id,
        phone: call.phone,
        scheduled_for: scheduled.toISOString(),
      },
      { onConflict: 'lead_id,phone,scheduled_for', ignoreDuplicates: true }
    );
  if (error) console.error('tourism callback not saved', error.code);
}

export async function syncTourismCalls(db, apiKey, fetchImpl = fetch) {
  const cutoff = new Date(Date.now() - 120000).toISOString();
  const calls = await checked(
    db
      .from('tourism_calls')
      .select('*')
      .not('conversation_id', 'is', null)
      .or(`finished_at.is.null,finished_at.gt.${cutoff}`)
      .order('finished_at', { ascending: true, nullsFirst: true })
      .order('created_at')
      .limit(8)
  );
  await Promise.all(
    calls.map(async (call) => {
      try {
        const response = await fetchImpl(
          `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(call.conversation_id)}`,
          { headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(18000) }
        );
        if (!response.ok) return;
        const data = await response.json().catch(() => null);
        if (
          data?.agent_id !== call.provider_agent_id ||
          data?.conversation_initiation_client_data?.dynamic_variables?.plw_tourism_call_id !== call.id
        )
          return;
        const now = new Date().toISOString();
        const source = Array.isArray(data.transcript) ? data.transcript : [];
        const transcript = source.slice(0, 500).map((t) => ({
          role: t.role === 'agent' ? 'agent' : 'user',
          message: String(t.message ?? '').slice(0, 10000),
          time_in_call_secs: Number(t.time_in_call_secs) || 0,
        }));
        const update = {
          transcript,
          summary: String(data.analysis?.transcript_summary ?? '').slice(0, 6000),
          synced_at: now,
        };
        if (['done', 'failed'].includes(data.status)) {
          update.state = data.status === 'done' ? 'completed' : 'failed';
          update.finished_at = call.finished_at || now;
        }
        await checked(db.from('tourism_calls').update(update).eq('id', call.id));
        const results = tourismCallResults(data.analysis);
        if (results.outcome || Object.keys(results.details).length) {
          const { error } = await db
            .from('tourism_calls')
            .update({ outcome: results.outcome, details: results.details })
            .eq('id', call.id);
          if (error) console.error('tourism outcome not saved', error.code);
        }
        if (results.optOut)
          await checked(
            db
              .from('ai_outbound_do_not_call')
              .upsert(
                { phone: call.phone, reason: 'Solicitud de exclusión en llamada de turismo' },
                { onConflict: 'phone', ignoreDuplicates: true }
              )
          );
        if (update.state) await scheduleCallback(db, call, results.details).catch(() => {});
      } catch {
        /* Retain reservations until the provider can be reconciled. */
      }
    })
  );
}

async function findTourismConversation(apiKey, call, fetchImpl) {
  const after = Math.floor(Date.parse(call.created_at) / 1000) - 120;
  const list = await fetchImpl(
    `https://api.elevenlabs.io/v1/convai/conversations?agent_id=${encodeURIComponent(call.provider_agent_id)}&call_start_after_unix=${after}&page_size=30`,
    { headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(18000) }
  );
  if (!list.ok) throw new Error('Conversation list unavailable');
  const listData = await list.json().catch(() => null);
  const candidates = (listData?.conversations ?? [])
    .filter((c) => {
      const start = Number(c?.start_time_unix_secs);
      return /^[A-Za-z0-9_-]{1,100}$/.test(String(c?.conversation_id)) && start >= after && start <= after + 720;
    })
    .slice(0, 10);
  for (const c of candidates) {
    const r = await fetchImpl(
      `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(c.conversation_id)}`,
      { headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(18000) }
    );
    if (
      r.ok &&
      (await r.json().catch(() => null))?.conversation_initiation_client_data?.dynamic_variables
        ?.plw_tourism_call_id === call.id
    )
      return c.conversation_id;
  }
  return null;
}

export async function reconcileTourismStuckCalls(db, apiKey, fetchImpl = fetch, now = Date.now()) {
  const calls = await checked(
    db
      .from('tourism_calls')
      .select('id,state,provider_agent_id,created_at')
      .in('state', ['uncertain', 'reserved'])
      .is('conversation_id', null)
      .lt('created_at', new Date(now - 120_000).toISOString())
      .or(`synced_at.is.null,synced_at.lt.${new Date(now - 60_000).toISOString()}`)
      .order('created_at')
      .limit(2)
  );
  for (const call of calls) {
    let conversationId = null;
    let searched = false;
    try {
      conversationId = await findTourismConversation(apiKey, call, fetchImpl);
      searched = true;
    } catch {
      /* Provider unavailable: retry next tick, never give up on a failed search. */
    }
    const stamp = new Date(now).toISOString();
    const update = conversationId
      ? { state: 'started', conversation_id: conversationId, error: '' }
      : searched && now - Date.parse(call.created_at) > STUCK_GIVE_UP_MS
        ? { state: 'failed', finished_at: stamp, error: 'Sin conversación en ElevenLabs después de 15 minutos. No se volverá a marcar.' }
        : {};
    await checked(
      db
        .from('tourism_calls')
        .update({ ...update, synced_at: stamp })
        .eq('id', call.id)
        .eq('state', call.state)
    );
  }
}

export async function runTourismTick(db, apiKey, fetchImpl = fetch) {
  await checked(
    db.from('tourism_dialer_runtime').update({ last_tick_at: new Date().toISOString(), last_error: '' }).eq('id', 1)
  );
  await syncTourismCalls(db, apiKey, fetchImpl);
  await reconcileTourismStuckCalls(db, apiKey, fetchImpl).catch(() => {});
  const runtime = await checked(db.from('tourism_dialer_runtime').select('*').eq('id', 1).maybeSingle());
  if (!runtime?.scheduler_ready || runtime.last_error === 'scheduler_paused' || !runtime.provider_agent_id) return;
  // Verified-agent gate: any drift from the saved configuration pauses tourism dialing.
  try {
    const config = await fetchImpl(
      `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(runtime.provider_agent_id)}`,
      { headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(18000) }
    );
    const { tourismConfigFailures } = await import('./provider.js');
    if (!config.ok || tourismConfigFailures(await config.json().catch(() => null), runtime).length) {
      await checked(
        db
          .from('tourism_dialer_runtime')
          .update({ provider_agent_id: null, config_verified_at: null, last_error: 'La configuración de voz cambió. Revísela antes de continuar.' })
          .eq('id', 1)
      );
      return;
    }
  } catch {
    await checked(
      db.from('tourism_dialer_runtime').update({ last_error: 'No se pudo verificar la voz. Las reservas permanecen protegidas.' }).eq('id', 1)
    );
    return;
  }
  // Shared line: at most one in-flight call across ALL dialers. Claim twice at most, then
  // dispatch in parallel; the claim function itself enforces the cap again under its lock.
  const claims = [];
  for (let i = 0; i < 2; i++) {
    try {
      const claim = await checked(db.rpc('claim_tourism_call'));
      if (claim) claims.push(claim);
    } catch (error) {
      console.error('tourism claim failed', error?.code ?? 'unknown');
      break;
    }
  }
  await Promise.allSettled(claims.map((claim) => dispatchTourismCall(db, apiKey, claim, fetchImpl)));
}
