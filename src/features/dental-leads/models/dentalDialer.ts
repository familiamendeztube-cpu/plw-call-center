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
  outcome?: string | null;
  /** What Anna noted: contact, callback time, visit day... (CALL_DETAIL_LABELS keys). */
  details?: Record<string, string>;
  /** Set once ElevenLabs took the call, so there is a transcript and a recording. */
  conversation_id?: string | null;
}
export interface DentalTranscript {
  transcript: { role: string; message: string; time_in_call_secs: number; tools: string[] }[];
  summary: string;
  synced_at: string | null;
  outcome?: string | null;
  details?: Record<string, string>;
}
/** Anna's call outcomes. */
export const CALL_OUTCOME: Record<string, string> = {
  APPOINTMENT_CONFIRMED: 'Cita confirmada',
  APPOINTMENT_REQUESTED: 'Visita solicitada',
  INTERESTED_FOLLOW_UP: 'Interesado · dar seguimiento',
  WHATSAPP_INFO_REQUESTED: 'Pidió información por WhatsApp',
  EMAIL_INFO_REQUESTED: 'Pidió información por correo',
  RECEPTIONIST_CONTACT: 'Habló con recepción',
  DECISION_MAKER_UNAVAILABLE: 'Encargado no disponible',
  CALLBACK_REQUESTED: 'Pidió que lo llamen',
  NOT_INTERESTED: 'No le interesa',
  DO_NOT_CALL: 'No volver a llamar',
  WRONG_NUMBER: 'Número equivocado',
  NO_ANSWER: 'No contestó',
  VOICEMAIL: 'Buzón de voz',
  TECHNICAL_FAILURE: 'Falla técnica',
};
export const CALL_DETAIL_LABELS: [key: string, label: string][] = [
  ['contact_name', 'Contacto'],
  ['contact_role', 'Puesto'],
  ['contact_phone', 'Teléfono o WhatsApp autorizado'],
  ['contact_email', 'Correo para la información'],
  ['business_address', 'Dirección'],
  ['appointment_date', 'Día de la visita'],
  ['appointment_time', 'Hora de la visita'],
  ['callback_time', 'Volver a llamar'],
  ['pain_point', 'Problema principal'],
  ['services_interest', 'Servicios de interés'],
  ['objections', 'Objeciones'],
  ['notes', 'Notas'],
];
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
