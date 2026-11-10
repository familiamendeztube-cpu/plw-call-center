import { providerRequest, safeAgent, conversationUpdate } from './provider.js';
import { SALES_SCRIPT_VERSION } from './salesScript.js';
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
            plw_dental_call_id: call.id,
            plw_script_version: SALES_SCRIPT_VERSION,
          },
        },
      },
      fetchImpl
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
  await checked(
    db
      .from('dental_calls')
      .update(
        accepted
          ? { state: 'started', conversation_id: id }
          : {
              state: rejected ? 'failed' : 'uncertain',
              error: rejected
                ? 'El proveedor rechazó la llamada.'
                : 'Resultado sin confirmar; no se volverá a marcar.',
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
        if (!call.lead_id) return;
        const f = r.data.analysis?.data_collection_results ?? {};
        if (f.plw_opt_out?.value === true)
          await checked(
            db
              .from('ai_outbound_do_not_call')
              .upsert(
                { phone: call.phone, reason: 'Solicitud de exclusión en llamada dental' },
                { onConflict: 'phone', ignoreDuplicates: true }
              )
          );
        else if (f.plw_callback?.value === true || f.plw_interested?.value === true)
          await checked(
            db
              .from('dental_leads')
              .update({
                status: f.plw_callback?.value ? 'callback' : 'interested',
                updated_at: new Date().toISOString(),
              })
              .eq('id', call.lead_id)
              .eq('status', 'pending')
          );
      } catch {
        /* Retain reservations until the provider can be reconciled. */
      }
    })
  );
}
export async function runTick(db, apiKey, fetchImpl = fetch) {
  await checked(
    db
      .from('dental_dialer_runtime')
      .update({ last_tick_at: new Date().toISOString(), last_error: '' })
      .eq('id', 1)
  );
  await syncCalls(db, apiKey, fetchImpl);
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
