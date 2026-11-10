export interface DentalDialer {
  staff_id: string;
  state: 'running' | 'paused' | 'stopped';
  provider_agent_id: string | null;
  config_verified_at: string | null;
  transfer_verified_at: string | null;
  last_error: string;
  pilot_call_limit?: number | null;
  pilot_baseline_count?: number;
}
export interface DentalRuntime {
  last_tick_at: string | null;
  scheduler_ready: boolean;
  last_error: string;
}
export interface DentalCall {
  id: string;
  lead_id: string | null;
  staff_id: string;
  phone: string;
  is_test: boolean;
  state: 'reserved' | 'started' | 'uncertain' | 'completed' | 'failed' | 'cancelled';
  transfer_status: 'none' | 'requested' | 'agent_confirmed' | 'failed';
  created_at: string;
  finished_at: string | null;
  error: string;
}
export interface DentalTranscript {
  transcript: { role: string; message: string; time_in_call_secs: number; tools: string[] }[];
  summary: string;
  synced_at: string | null;
}
export const CALL_STATE = {
  reserved: 'Preparando',
  started: 'Iniciada',
  uncertain: 'Sin confirmar',
  completed: 'Finalizada',
  failed: 'Fallida',
  cancelled: 'Cancelada',
};
export const TRANSFER_STATE = {
  none: 'Sin transferencia',
  requested: 'Solicitada',
  agent_confirmed: 'Confirmada por el agente',
  failed: 'Fallida',
};
export function dialerReady(
  route: DentalDialer | undefined,
  runtime: DentalRuntime | null,
  now = Date.now()
) {
  const age = runtime?.last_tick_at ? now - new Date(runtime.last_tick_at).getTime() : Infinity;
  return Boolean(
    route?.provider_agent_id &&
    route.config_verified_at &&
    (route.transfer_verified_at ||
      (route.pilot_call_limit && route.pilot_call_limit >= 1 && route.pilot_call_limit <= 20)) &&
    runtime?.scheduler_ready &&
    age >= -5000 &&
    age < 120000
  );
}
