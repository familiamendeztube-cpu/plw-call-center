// US dispatcher runner: same proven mechanics as the tourism runner (dispatch, sync,
// reconcile) against us_* tables, with E.164 destination numbers, IANA/DST-aware callback
// scheduling and the US outcome mapping. Never touches tourism or dental rows.
import { providerReason, usAsrKeywords, usCallResults, usConfigFailures, isSip403Error } from './provider.js';
import { US_SCRIPT_VERSION, PLW_US_ADDRESS } from './usScript.js';

const OUTBOUND_TIMEOUT_S = 45;
const STUCK_GIVE_UP_MS = 15 * 60_000;

export const isPaused = (runtime) => runtime.paused === true;

async function checked(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function dispatchUsCall(db, apiKey, claim, fetchImpl = fetch) {
  const { call } = claim;
  const lead = claim.lead ?? {};
  const runtime = await checked(db.from('us_dialer_runtime').select('*').eq('id', 1).maybeSingle());
  if (!call.is_test && (!runtime?.scheduler_ready || isPaused(runtime))) {
    await checked(
      db
        .from('us_calls')
        .update({ state: 'cancelled', error: 'Marcador pausado antes del envío.', finished_at: new Date().toISOString() })
        .eq('id', call.id)
        .eq('state', 'reserved')
    );
    return;
  }
  // Exclusión DNC antes de llamar (lista compartida de exclusiones).
  const blocked = await checked(
    db.from('ai_outbound_do_not_call').select('phone').eq('phone', call.phone).maybeSingle()
  );
  if (blocked) {
    await checked(
      db
        .from('us_calls')
        .update({ state: 'cancelled', error: 'Número bloqueado.', finished_at: new Date().toISOString() })
        .eq('id', call.id)
    );
    return;
  }
  let result;
  // The Telnyx number as imported in ElevenLabs (Configurar saves it). Never the Costa Rica line.
  if (!runtime?.phone_number_id || !runtime?.transfer_uri) {
    await checked(
      db
        .from('us_calls')
        .update({ state: 'cancelled', error: 'Falta el número de EE. UU. en ElevenLabs o la ruta de transferencia.', finished_at: new Date().toISOString() })
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
        agent_phone_number_id: runtime.phone_number_id,
        // Full E.164 destination: the destination string is never truncated to its last digits.
        to_number: call.phone,
        conversation_initiation_client_data: {
          dynamic_variables: {
            business_name: lead.business_name || 'su negocio',
            contact_name: lead.contact_name || '',
            business_type: lead.business_type || 'servicios',
            plw_office: PLW_US_ADDRESS,
            plw_us_call_id: call.id,
            plw_transfer_uri: runtime.transfer_uri,
            plw_script_version: US_SCRIPT_VERSION,
          },
          conversation_config_override: { asr: { keywords: usAsrKeywords(lead.business_name) } },
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
      .from('us_calls')
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
    await recordUsResult(
      db,
      { ...call, error: `El proveedor rechazó la llamada${reason}.` },
      isSip403Error(reason)
    );
}

export async function syncUsCalls(db, apiKey, fetchImpl = fetch) {
  const cutoff = new Date(Date.now() - 120000).toISOString();
  const calls = await checked(
    db
      .from('us_calls')
      .select('id, lead_id, phone, provider_agent_id, conversation_id, created_at, finished_at, is_test, error')
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
          data?.conversation_initiation_client_data?.dynamic_variables?.plw_us_call_id !== call.id
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
        await checked(db.from('us_calls').update(update).eq('id', call.id));
        const results = usCallResults(data.analysis);
        if (results.outcome || Object.keys(results.details).length) {
          const { error } = await db
            .from('us_calls')
            .update({ outcome: results.outcome, details: results.details, ended_reason: results.endedReason })
            .eq('id', call.id);
          if (error) console.error('us outcome not saved', error.code);
        }
        if (results.optOut)
          await checked(
            db
              .from('ai_outbound_do_not_call')
              .upsert(
                { phone: call.phone, reason: 'Solicitud de exclusión en llamada de EE. UU.' },
                { onConflict: 'phone', ignoreDuplicates: true }
              )
          );
        if (update.state) {
          if (update.state === 'failed' && isSip403Error(call.error)) await recordUsResult(db, call);
          else if (update.state === 'completed') await recordUsResult(db, call, false);
          // Interested, transferred or callback calls land in Clientes for Alejandro, and an agreed
          // day and time becomes his follow-up; idempotent per conversation.
          const { error: customerError } = await db.rpc('us_call_to_customer', { p_call_id: call.id });
          if (customerError) console.error('us customer not created', customerError.code);
        }
      } catch {
        /* Retain reservations until the provider can be reconciled. */
      }
    })
  );
}

async function findUsConversation(apiKey, call, fetchImpl) {
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
        ?.plw_us_call_id === call.id
    )
      return c.conversation_id;
  }
  return null;
}

export async function reconcileUsStuckCalls(db, apiKey, fetchImpl = fetch, now = Date.now()) {
  const calls = await checked(
    db
      .from('us_calls')
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
      conversationId = await findUsConversation(apiKey, call, fetchImpl);
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
        .from('us_calls')
        .update({ ...update, synced_at: stamp })
        .eq('id', call.id)
        .eq('state', call.state)
    );
  }
}

const setRuntime = (db, values) => checked(db.from('us_dialer_runtime').update(values).eq('id', 1));

async function recordUsResult(db, call, dispatchError) {
  if (call.is_test) return;
  const hit = dispatchError !== undefined ? dispatchError : isSip403Error(call.error);
  if (!hit) {
    await setRuntime(db, { consecutive_403: 0 }).catch(() => {});
    return;
  }
  const current = await checked(
    db.from('us_dialer_runtime').select('consecutive_403,paused').eq('id', 1).maybeSingle()
  );
  const streak = (current?.consecutive_403 ?? 0) + 1;
  if (streak >= 2 && current?.paused !== true) {
    await setRuntime(db, { paused: true, consecutive_403: streak });
    const { error } = await db.from('us_dialer_alerts').insert({
      reason: 'Pausa automática: dos llamadas seguidas fueron rechazadas por el proveedor (SIP 403). La campaña quedó pausada; revise la línea con el proveedor antes de Iniciar.',
      evidence: {
        calls: [
          { phone: call.phone, business: call.lead?.business_name ?? null, call_id: call.id, at: new Date().toISOString(), error: call.error ?? String(dispatchError) },
        ],
      },
    });
    if (error) console.error('us alert not saved', error.code);
  } else {
    await setRuntime(db, { consecutive_403: streak });
  }
}

export async function runUsTick(db, apiKey, fetchImpl = fetch) {
  await setRuntime(db, { last_tick_at: new Date().toISOString() });
  await syncUsCalls(db, apiKey, fetchImpl);
  await reconcileUsStuckCalls(db, apiKey, fetchImpl).catch(() => {});
  const runtime = await checked(db.from('us_dialer_runtime').select('*').eq('id', 1).maybeSingle());
  if (!runtime?.scheduler_ready || isPaused(runtime) || !runtime.provider_agent_id || !runtime.config_verified_at)
    return;
  let failures;
  try {
    const config = await fetchImpl(
      `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(runtime.provider_agent_id)}`,
      { headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(18000) }
    );
    failures = config.ok ? usConfigFailures(await config.json().catch(() => null), runtime) : ['provider_read'];
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
  // Up to max_lines calls at once; claim_us_call enforces the limit under its lock and returns
  // nothing once the lines are full.
  const claims = [];
  for (let i = 0; i < Math.max(1, runtime.max_lines ?? 1); i++) {
    try {
      const claim = await checked(db.rpc('claim_us_call'));
      if (claim) claims.push(claim);
    } catch (error) {
      console.error('us claim failed', error?.code ?? 'unknown');
      break;
    }
  }
  await Promise.allSettled(claims.map((claim) => dispatchUsCall(db, apiKey, claim, fetchImpl)));
}
