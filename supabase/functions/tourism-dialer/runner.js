// Tourism dispatcher runner: same proven mechanics as the dental runner (dispatch, sync,
// reconcile) against tourism tables, with tourism outcome mapping and exactly-once
// callback scheduling. Never touches dental rows.
import { providerReason, tourismCallResults, tourismConfigFailures, isSip403Error } from './provider.js';
import {
  TOURISM_SCRIPT_VERSION,
  greetingFor,
} from './tourismScript.js';

const OUTBOUND_TIMEOUT_S = 45;
const STUCK_GIVE_UP_MS = 15 * 60_000;

// ponytail: the 'scheduler_paused' marker is the pre-20261119200000 pause. Honouring it keeps
// this code safe if Bolt deploys it before that migration runs; drop it once the SQL is live.
export const isPaused = (runtime) => runtime.paused === true || runtime.last_error === 'scheduler_paused';

async function checked(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function dispatchTourismCall(db, apiKey, claim, fetchImpl = fetch) {
  // Admin test calls (reserve_tourism_test) carry no lead and run while the dialer is paused.
  const { call } = claim;
  const lead = claim.lead ?? {};
  const runtime = await checked(db.from('tourism_dialer_runtime').select('*').eq('id', 1).maybeSingle());
  if (!call.is_test && (!runtime?.scheduler_ready || isPaused(runtime))) {
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
  if (rejected)
    await recordTourismResult(
      db,
      { ...call, error: `El proveedor rechazó la llamada${reason}.` },
      isSip403Error(reason)
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
        if (update.state) {
          if (update.state === 'failed' && isSip403Error(call.error)) await recordTourismResult(db, call);
          else if (update.state === 'completed') await recordTourismResult(db, call, false);
          await scheduleCallback(db, call, results.details).catch(() => {});
          // Interested calls land in Clientes for Alejandro; idempotent per conversation.
          // Runs before the milestones: they attach to the customer row this creates, and on
          // the call that first creates it they used to find nothing and were lost.
          const { error } = await db.rpc('tourism_call_to_customer', { p_call_id: call.id });
          if (error) console.error('tourism customer not created', error.code);
          // A confirmed day+time promise becomes Alejandro's follow-up at that time plus the
          // "Devolución agendada" milestone. In SQL: the service role cannot read prospects.
          if (results.details.callback_date && results.details.callback_clock) {
            const { error: promiseError } = await db.rpc('tourism_hand_promise_to_agent', { p_call_id: call.id });
            if (promiseError) console.error('tourism promise not handed to the agent', promiseError.code);
          }
          // A confirmed demo day+time is "Demo agendada"; the RPC guards duplicates,
          // slot changes and never completes the demo by itself.
          if (results.details.demo_date && results.details.demo_clock) {
            const demoSlot = new Date(
              `${results.details.demo_date}T${results.details.demo_clock}:00-06:00`
            );
            if (!Number.isNaN(demoSlot.getTime())) {
              await db
                .rpc('record_tourism_demo_agreement', {
                  p_call_id: call.id,
                  p_due_at: demoSlot.toISOString(),
                })
                .then(
                  ({ error: demoError }) => {
                    if (demoError) console.error('tourism demo agreement not saved', demoError.code);
                  },
                  () => {}
                );
            }
          }
        }
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

const setRuntime = (db, values) => checked(db.from('tourism_dialer_runtime').update(values).eq('id', 1));

/** Called once per settled campaign call (synced completion, dispatch failure or 403).
 *  Test attempts never count; replays are guarded by the unique alert and the
 *  state-conditional updates. */
async function recordTourismResult(db, call, dispatchError) {
  if (call.is_test) return;
  const hit = dispatchError !== undefined ? dispatchError : isSip403Error(call.error);
  if (!hit) {
    // Any intervening non-403 result resets the streak.
    await setRuntime(db, { consecutive_403: 0 }).catch(() => {});
    return;
  }
  const current = await checked(
    db.from('tourism_dialer_runtime').select('consecutive_403,paused').eq('id', 1).maybeSingle()
  );
  const streak = (current?.consecutive_403 ?? 0) + 1;
  if (streak >= 2 && current?.paused !== true) {
    await setRuntime(db, { paused: true, consecutive_403: streak });
    const { error } = await db.from('tourism_dialer_alerts').insert({
      reason: 'Pausa automática: dos llamadas seguidas fueron rechazadas por el proveedor (SIP 403). La campaña quedó pausada; revise la línea con el proveedor antes de Iniciar.',
      evidence: {
        calls: [
          { phone: call.phone, business: call.lead?.business_name ?? null, call_id: call.id, at: new Date().toISOString(), error: call.error ?? String(dispatchError) },
        ],
      },
    });
    if (error) console.error('tourism alert not saved', error.code);
  } else {
    await setRuntime(db, { consecutive_403: streak });
  }
}

/** Failed promised callbacks rise to the assigned agent's follow-up queue, once each. */
async function raiseFailedPromises(db) {
  const failed = await checked(
    db
      .from('tourism_callbacks')
      .select('id, fail_reason')
      .eq('status', 'failed')
      .is('resolved_at', null)
      .limit(10)
  );
  for (const row of failed) {
    try {
      await db.rpc('tourism_raise_failed_promise', {
        p_callback_id: row.id,
        p_reason: row.fail_reason ?? '',
      });
    } catch (error) {
      console.error('tourism failed-promise follow-up not raised', error?.code ?? 'unknown');
    }
  }
}

export async function runTourismTick(db, apiKey, fetchImpl = fetch) {
  // Heartbeat records while paused too, or Iniciar's 2-minute freshness check can never
  // pass. Only Pausar/Iniciar touch the `paused` flag.
  await setRuntime(db, { last_tick_at: new Date().toISOString() });
  await syncTourismCalls(db, apiKey, fetchImpl);
  await reconcileTourismStuckCalls(db, apiKey, fetchImpl).catch(() => {});
  await raiseFailedPromises(db).catch(() => {});
  const runtime = await checked(db.from('tourism_dialer_runtime').select('*').eq('id', 1).maybeSingle());
  if (!runtime?.scheduler_ready || isPaused(runtime) || !runtime.provider_agent_id || !runtime.config_verified_at)
    return;
  // Two consecutive SIP 403s mean the provider line is refusing us: pause before the next
  // automatic dispatch and leave a persistent alert. Test attempts never count; any
  // intervening non-403 result resets the counter; only an explicit admin restart clears it.
  // Verified-agent gate. A provider hiccup (network, 5xx, 429, unreadable body) only skips
  // this tick; real drift un-verifies the configuration but keeps the agent id, so
  // Reconfigurar patches the same ElevenLabs agent instead of creating a new one.
  let failures;
  try {
    const config = await fetchImpl(
      `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(runtime.provider_agent_id)}`,
      { headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(18000) }
    );
    failures = config.ok ? tourismConfigFailures(await config.json().catch(() => null), runtime) : ['provider_read'];
  } catch {
    failures = ['provider_read'];
  }
  if (failures.includes('provider_read')) {
    await setRuntime(db, { last_error: 'No se pudo verificar la voz en ElevenLabs; se reintentará. No se marca mientras tanto.' });
    return;
  }
  if (failures.length) {
    await setRuntime(db, {
      config_verified_at: null,
      last_error: `La configuración de voz cambió (${failures.join(', ')}). Presione Reconfigurar.`,
    });
    return;
  }
  if (runtime.last_error) await setRuntime(db, { last_error: '' });
  if ((runtime.consecutive_403 ?? 0) >= 2) return;
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
