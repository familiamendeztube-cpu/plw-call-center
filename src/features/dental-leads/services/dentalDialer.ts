import { getSupabaseClient } from '@/integrations/supabase/client';
import {
  callStaffFunction,
  postStaffFunction,
  readStaffFunctionError,
} from '@/integrations/supabase/callStaffFunction';
import type {
  DentalCall,
  DentalDialer,
  DentalRuntime,
  DentalTranscript,
} from '../models/dentalDialer';
import type {
  DentalCallMatch,
  IncomingDentalCallRow,
  IncomingDentalLead,
} from '../models/incomingDentalCall';
export interface DialerReadFailure {
  code?: string;
  status?: number;
  message?: string;
}
export function dialerReadError(error: DialerReadFailure) {
  if (error.status === 401 || error.code === 'PGRST301' || /jwt|expired/i.test(error.message ?? ''))
    return new Error('Su sesión venció. Ingrese de nuevo para continuar.');
  if (error.code === '42P01' || error.code === 'PGRST205')
    return new Error('Falta instalar o conectar el control del marcador dental.');
  return new Error('No se pudo leer el marcador. Reintente en unos segundos.');
}
export async function loadDialer(signal: AbortSignal) {
  const db = getSupabaseClient();
  const [routes, runtime] = await Promise.all([
    db
      .from('dental_agent_dialers')
      .select(
        'staff_id,state,provider_agent_id,config_verified_at,transfer_verified_at,last_error,pilot_call_limit,pilot_baseline_count'
      )
      .abortSignal(signal),
    db
      .from('dental_dialer_runtime')
      .select('last_tick_at,scheduler_ready,last_error')
      .eq('id', 1)
      .abortSignal(signal)
      .single(),
  ]);
  if (routes.error) throw dialerReadError(routes.error);
  if (runtime.error) throw dialerReadError(runtime.error);
  const calls: DentalCall[] = [];
  for (let start = 0; ; start += 1000) {
    const result = await db
      .from('dental_calls')
      .select(
        'id,lead_id,staff_id,phone,is_test,state,transfer_status,created_at,finished_at,error,outcome,details,conversation_id'
      )
      .order('created_at', { ascending: false })
      .order('id')
      .range(start, start + 999)
      .abortSignal(signal);
    if (result.error) throw dialerReadError(result.error);
    calls.push(...(result.data as DentalCall[]));
    if (result.data.length < 1000) break;
  }
  return { routes: routes.data as DentalDialer[], runtime: runtime.data as DentalRuntime, calls };
}
export async function controlDialer(staffId: string, action: string) {
  // Refuses activate/resume unless the agent has the app open and is set to Activo.
  const { error } = await getSupabaseClient().rpc('control_dental_dialer_if_active', {
    p_staff_id: staffId,
    p_action: action,
  });
  if (error)
    throw new Error(
      error.message ||
        'No se pudo guardar la acción. Verifique el servidor y la prueba de transferencia.'
    );
}
export async function startNextBatch(staffId: string) {
  // Same activation rules as Continuar; refused activation leaves the batch unchanged.
  const { error } = await getSupabaseClient().rpc('start_next_dental_batch', {
    p_staff_id: staffId,
  });
  if (error) throw new Error(error.message || 'No se pudo iniciar la siguiente tanda.');
}
export async function dentalServerAction(input: Record<string, unknown>) {
  return await callStaffFunction('dental-dialer', input);
}

export type DemoSampleVoice = { role: 'ana' | 'patient'; name: string; voice_id: string };

export async function fetchDemoSample(): Promise<{ blob: Blob; voices: DemoSampleVoice[] }> {
  const response = await postStaffFunction('dental-dialer', { action: 'demo_sample' });
  if (!response.ok) throw await readStaffFunctionError(response);
  const voices = parseDemoVoices(response.headers.get('X-Demo-Voices'));
  return { blob: await response.blob(), voices };
}

function parseDemoVoices(header: string | null): DemoSampleVoice[] {
  if (!header) return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(header));
    return Array.isArray(parsed) ? (parsed as DemoSampleVoice[]) : [];
  } catch {
    return [];
  }
}
export async function loadTranscript(id: string, signal: AbortSignal) {
  const { data, error } = await getSupabaseClient()
    .from('dental_calls')
    .select('transcript,summary,synced_at,outcome,details')
    .eq('id', id)
    .abortSignal(signal)
    .single();
  if (error) throw new Error('No se pudo cargar la transcripción.');
  return data as DentalTranscript;
}
// A transfer reaches the agent minutes after Anna dialed; a call to the same number long after
// that is an ordinary call and shouldn't show an old conversation.
const RECENT_DENTAL_CALL_MS = 30 * 60_000;
/** The dental call behind a live call, or null when a number matches no recent dental call. */
export async function loadIncomingDentalCall(
  match: DentalCallMatch,
  signal: AbortSignal
): Promise<{ call: IncomingDentalCallRow; lead: IncomingDentalLead | null } | null> {
  const db = getSupabaseClient();
  const query = db
    .from('dental_calls')
    .select('id,lead_id,staff_id,phone,state,transfer_status,summary,transcript,details')
    .abortSignal(signal);
  const callResult = await (match.id
    ? query.eq('id', match.id)
    : query
        .eq('phone', match.phone ?? '')
        .gte('created_at', new Date(Date.now() - RECENT_DENTAL_CALL_MS).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
  ).maybeSingle();
  if (callResult.error) throw new Error('No se pudo cargar la llamada.');
  if (!callResult.data) {
    if (match.id) throw new Error('La llamada no existe o no está disponible.');
    return null;
  }
  const call = callResult.data as IncomingDentalCallRow;
  const leadResult = await db
    .from('dental_leads')
    .select('id,business_name,contact_name,province,canton,address')
    .eq('id', call.lead_id)
    .abortSignal(signal)
    .maybeSingle();
  if (leadResult.error) throw new Error('No se pudo cargar el dentista.');
  return { call, lead: (leadResult.data as IncomingDentalLead | null) ?? null };
}
export async function confirmTransfer(id: string) {
  const { error } = await getSupabaseClient().rpc('confirm_dental_transfer', { p_call_id: id });
  if (error) throw new Error('Solo el agente que recibió esta transferencia puede confirmarla.');
}
