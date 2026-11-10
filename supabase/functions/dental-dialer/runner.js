import {
  providerRequest,
  providerReason,
  safeAgent,
  conversationUpdate,
  callResults,
} from './provider.js';
import { SALES_SCRIPT_VERSION, greetingFor } from './salesScript.js';
// ElevenLabs answers only once the call connects or fails, and a phone rings well past 18 s.
// 45 s keeps a whole tick inside the scheduler's 60 s HTTP timeout.
const OUTBOUND_TIMEOUT_S = 45;
// After this, an unconfirmed call with no ElevenLabs conversation stops holding a slot.
const STUCK_GIVE_UP_MS = 15 * 60_000;
async function checked(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
export async function dispatchCall(db, apiKey, claim, fetchImpl = fetch) {
  const { call, route, lead } = claim;
  if (!call.is_test) {
    const current = await checked(
      db.from('dental_agent_dialers').select('state').eq('staff_id', call.staff_id).maybeSingle()
    );
    if (current?.state !== 'running') {
      await checked(
        db
          .from('dental_calls')
          .update({
            state: 'cancelled',
            error: 'Marcador pausado antes del envío.',
            finished_at: new Date().toISOString(),
          })
          .eq('id', call.id)
          .eq('state', 'reserved')
      );
      return;
    }
  }
  const blocked = await checked(
    db.from('ai_outbound_do_not_call').select('phone').eq('phone', call.phone).maybeSingle()
  );
  if (blocked) {
    await checked(
      db
        .from('dental_calls')
        .update({
          state: 'cancelled',
          error: 'Número bloqueado.',
          finished_at: new Date().toISOString(),
        })
        .eq('id', call.id)
    );
    return;
  }
  let result;
  try {
    result = await providerRequest(
      apiKey,
      '/sip-trunk/outbound-call',
      {
        agent_id: route.provider_agent_id,
        agent_phone_number_id: route.caller_phone_number_id,
        to_number: `+506${call.phone}`,
        conversation_initiation_client_data: {
          dynamic_variables: {
            business_name: lead.business_name,
            business_type: 'Clínica dental',
            contact_name: lead.contact_name || 'la persona encargada',
            saludo: greetingFor(),
            plw_dental_call_id: call.id,
            plw_script_version: SALES_SCRIPT_VERSION,
          },
        },
      },
      fetchImpl,
      'POST',
      OUTBOUND_TIMEOUT_S * 1000
    );
  } catch {
    result = { ok: false, status: 0, data: null };
  }
  const id = result.data?.conversation_id;
  const accepted =
    result.ok &&
    result.data?.success === true &&
    typeof id === 'string' &&
    /^[A-Za-z0-9_-]{1,100}$/.test(id);
  const rejected =
    (result.status >= 400 && result.status < 500) || (result.ok && result.data?.success === false);
  const reason = accepted ? '' : providerReason(result, OUTBOUND_TIMEOUT_S);
  await checked(
    db
      .from('dental_calls')
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
export async function syncCalls(db, apiKey, fetchImpl = fetch) {
  const cutoff = new Date(Date.now() - 120000).toISOString();
  const calls = await checked(
    db
      .from('dental_calls')
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
        const r = await providerRequest(
          apiKey,
          `/conversations/${encodeURIComponent(call.conversation_id)}`,
          undefined,
          fetchImpl
        );
        if (!r.ok) return;
        const update = conversationUpdate(r.data, call);
        if (!update) return;
        const transfer = update.transfer_status;
        delete update.transfer_status;
        await checked(db.from('dental_calls').update(update).eq('id', call.id));
        if (transfer === 'requested')
          await checked(
            db
              .from('dental_calls')
              .update({ transfer_status: 'requested' })
              .eq('id', call.id)
              .eq('transfer_status', 'none')
          );
        const results = callResults(r.data.analysis);
        if (results.outcome || Object.keys(results.details).length) {
          // Separate write: if the outcome columns are missing, the call still syncs.
          const { error } = await db
            .from('dental_calls')
            .update({ outcome: results.outcome, details: results.details })
            .eq('id', call.id);
          if (error) console.error('dental outcome not saved', error.code);
        }
        if (!call.lead_id) return;
        if (results.optOut)
          await checked(
            db
              .from('ai_outbound_do_not_call')
              .upsert(
                { phone: call.phone, reason: 'Solicitud de exclusión en llamada dental' },
                { onConflict: 'phone', ignoreDuplicates: true }
              )
          );
        if (results.leadStatus) {
          const lead = db
            .from('dental_leads')
            .update({ status: results.leadStatus, updated_at: new Date().toISOString() })
            .eq('id', call.lead_id);
          // An opt-out overrides any status; other results only fill a lead nobody has worked yet.
          await checked(
            results.optOut ? lead.neq('status', 'do_not_call') : lead.eq('status', 'pending')
          );
        }
      } catch {
        /* Retain reservations until the provider can be reconciled. */
      }
    })
  );
}
// Finds the ElevenLabs conversation whose dynamic variable carries this call's id.
async function findConversation(apiKey, call, fetchImpl) {
  const after = Math.floor(Date.parse(call.created_at) / 1000) - 120;
  const list = await providerRequest(
    apiKey,
    `/conversations?agent_id=${encodeURIComponent(call.provider_agent_id)}&call_start_after_unix=${after}&page_size=30`,
    undefined,
    fetchImpl
  );
  if (!list.ok) throw new Error('Conversation list unavailable');
  const candidates = (list.data?.conversations ?? [])
    .filter((c) => {
      const start = Number(c?.start_time_unix_secs);
      return /^[A-Za-z0-9_-]{1,100}$/.test(String(c?.conversation_id)) && start >= after && start <= after + 720;
    })
    .slice(0, 10);
  for (const c of candidates) {
    const r = await providerRequest(apiKey, `/conversations/${encodeURIComponent(c.conversation_id)}`, undefined, fetchImpl);
    if (
      r.ok &&
      r.data?.agent_id === call.provider_agent_id &&
      r.data?.conversation_initiation_client_data?.dynamic_variables?.plw_dental_call_id === call.id
    )
      return c.conversation_id;
  }
  return null;
}
/**
 * Unconfirmed calls (and reservations a crash left behind) hold a slot until resolved.
 * A found conversation hands the call to the normal sync; a call with no conversation after
 * 15 minutes is closed as failed. Neither path ever dials the lead again.
 */
export async function reconcileStuckCalls(db, apiKey, fetchImpl = fetch, now = Date.now()) {
  const calls = await checked(
    db
      .from('dental_calls')
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
      conversationId = await findConversation(apiKey, call, fetchImpl);
      searched = true;
    } catch {
      /* Provider unavailable: retry next minute, never give up on a failed search. */
    }
    const stamp = new Date(now).toISOString();
    const update = conversationId
      ? { state: 'started', conversation_id: conversationId, error: '' }
      : searched && now - Date.parse(call.created_at) > STUCK_GIVE_UP_MS
        ? {
            state: 'failed',
            finished_at: stamp,
            error: 'Sin conversación en ElevenLabs después de 15 minutos. No se volverá a marcar.',
          }
        : {};
    await checked(
      db
        .from('dental_calls')
        .update({ ...update, synced_at: stamp })
        .eq('id', call.id)
        .eq('state', call.state)
    );
  }
}
export async function runTick(db, apiKey, fetchImpl = fetch) {
  await checked(
    db
      .from('dental_dialer_runtime')
      .update({ last_tick_at: new Date().toISOString(), last_error: '' })
      .eq('id', 1)
  );
  await syncCalls(db, apiKey, fetchImpl);
  await reconcileStuckCalls(db, apiKey, fetchImpl).catch(() => {});
  const routes = await checked(db.from('dental_agent_dialers').select('*').eq('state', 'running'));
  await Promise.all(
    routes.map(async (route) => {
      try {
        const config = await providerRequest(
          apiKey,
          `/agents/${encodeURIComponent(route.provider_agent_id)}`,
          undefined,
          fetchImpl
        );
        if (!config.ok || !safeAgent(config.data, route)) {
          await checked(
            db
              .from('dental_agent_dialers')
              .update({
                state: 'paused',
                config_verified_at: null,
                last_error:
                  'La configuración de voz o transferencia cambió. Revísela antes de continuar.',
              })
              .eq('staff_id', route.staff_id)
          );
          return;
        }
        const dispatched = await Promise.allSettled(
          [0, 1].map(async () => {
            const claim = await checked(
              db.rpc('claim_dental_call', { p_staff_id: route.staff_id })
            );
            if (claim) await dispatchCall(db, apiKey, claim, fetchImpl);
          })
        );
        if (dispatched.some((result) => result.status === 'rejected'))
          throw new Error('Dispatch incomplete');
      } catch {
        await checked(
          db
            .from('dental_agent_dialers')
            .update({
              last_error: 'No se pudo completar el ciclo. Las reservas permanecen protegidas.',
            })
            .eq('staff_id', route.staff_id)
        );
      }
    })
  );
}
