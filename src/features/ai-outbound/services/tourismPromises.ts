import { costaRicaLocalInputToIso } from '@/app/dates';
import { getSupabaseClient } from '@/integrations/supabase/client';

export interface TourismPromise {
  id: string;
  phone: string;
  scheduled_for: string;
  promised_at: string | null;
  status: string;
  fail_reason: string | null;
  resolved_at: string | null;
  business: string | null;
  owner: string | null;
}

export interface TourismAlert {
  id: string;
  reason: string;
  evidence: { calls?: { phone?: string; business?: string | null; error?: string }[] } | null;
  created_at: string;
  cleared_at: string | null;
}

const PROMISE_COLUMNS = `id, phone, scheduled_for, promised_at, status, fail_reason, resolved_at,
  lead:ai_outbound_leads(business_name, owner_id)`;

const mapPromise = (row: Record<string, unknown>): TourismPromise => {
  const lead = (row.lead ?? null) as { business_name?: string; owner_id?: string } | null;
  return {
    id: String(row.id),
    phone: String(row.phone),
    scheduled_for: String(row.scheduled_for),
    promised_at: row.promised_at ? String(row.promised_at) : null,
    status: String(row.status),
    fail_reason: row.fail_reason ? String(row.fail_reason) : null,
    resolved_at: row.resolved_at ? String(row.resolved_at) : null,
    business: lead?.business_name ?? null,
    owner: lead?.owner_id ?? null,
  };
};

/** Failed, unresolved promised callbacks first (the top of Alejandro's queue), then pending. */
export async function listTourismPromises(): Promise<TourismPromise[]> {
  const { data, error } = await getSupabaseClient()
    .from('tourism_callbacks')
    .select(PROMISE_COLUMNS)
    .in('status', ['failed', 'pending'])
    // Alphabetical: 'failed' < 'pending', so ascending puts the missed promises on top.
    .order('status', { ascending: true })
    .order('scheduled_for', { ascending: true })
    .limit(50);
  if (error) throw new Error('No se pudieron cargar las promesas de devolución de llamada.');
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapPromise);
}

export async function listTourismAlerts(): Promise<TourismAlert[]> {
  const { data, error } = await getSupabaseClient()
    .from('tourism_dialer_alerts')
    .select('id, reason, evidence, created_at, cleared_at')
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) throw new Error('No se pudieron cargar las alertas del marcador.');
  return ((data ?? []) as unknown as TourismAlert[]).map((row) => ({
    ...row,
    evidence: (row.evidence ?? null) as TourismAlert['evidence'],
  }));
}

export async function resolveTourismPromise(id: string, note: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc('resolve_tourism_callback', {
    p_callback_id: id,
    p_note: note,
  });
  if (error) throw new Error(error.message || 'No se pudo resolver la promesa.');
}

/** `slot` is a datetime-local value ("2026-11-24T10:00") meant as Costa Rica time. Sent raw,
 *  the database would read it as UTC and dial six hours early. */
export async function rescheduleTourismPromise(id: string, slot: string, note: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc('reschedule_tourism_callback', {
    p_callback_id: id,
    p_new_slot: costaRicaLocalInputToIso(slot),
    p_note: note,
  });
  if (error) throw new Error(error.message || 'No se pudo reagendar la promesa.');
}

export async function restartTourismAfterAlert(): Promise<void> {
  const { error } = await getSupabaseClient().rpc('restart_tourism_after_alert');
  if (error) throw new Error(error.message || 'No se pudo registrar el reinicio.');
}
