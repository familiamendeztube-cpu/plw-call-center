import { getSupabaseClient } from '@/integrations/supabase/client';

const US_CAMPAIGN_NAME = 'EE. UU. · Negocios en español';

/** How each of Anna's call outcomes reads in Spanish. */
export const US_OUTCOME_LABELS: Record<string, string> = {
  APPOINTMENT_CONFIRMED: 'Cita confirmada',
  INTERESTED_FOLLOW_UP: 'Interesado',
  EMAIL_INFO_REQUESTED: 'Pidió correo',
  CALLBACK_REQUESTED: 'Volver a llamar',
  DEMO_SCHEDULED: 'Demo agendada',
  RECEPTIONIST_CONTACT: 'Recepción',
  DECISION_MAKER_UNAVAILABLE: 'Encargado no disponible',
  NOT_INTERESTED: 'No interesado',
  DO_NOT_CALL: 'No llamar',
  WRONG_NUMBER: 'Número equivocado',
  NO_ANSWER: 'No contestó',
  VOICEMAIL: 'Buzón de voz',
  IVR_NO_HUMAN: 'Solo menú automático',
  TECHNICAL_FAILURE: 'Falla técnica',
};

export interface UsLead {
  id: string;
  raw_phone: string;
  phone_e164: string | null;
  dest: 'us' | 'ca' | 'cr' | 'invalid' | 'other' | 'dup' | 'dnc';
  contact_name: string;
  business_name: string;
  business_type: string;
  timezone: string;
  consent_ref: string;
  sms_mobile: string;
  sms_consent: boolean;
  excluded_reason: string;
  last_call_at: string | null;
  created_at: string;
}

export async function getUsCampaign(): Promise<{ id: string } | null> {
  const { data, error } = await getSupabaseClient()
    .from('us_campaigns')
    .select('id')
    .eq('name', US_CAMPAIGN_NAME)
    .maybeSingle();
  if (error) throw new Error('No se pudo leer la campaña de EE. UU.');
  return data;
}

export async function importUsLeads(
  campaignId: string,
  rows: { raw_phone: string; business_name: string; contact_name: string; business_type: string; consent_ref: string }[]
): Promise<number> {
  const { data, error } = await getSupabaseClient().from('us_leads').insert(
    rows.map((row) => ({ ...row, campaign_id: campaignId }))
  ).select('id');
  if (error) throw new Error('No se pudieron importar los contactos de EE. UU.');
  return data?.length ?? 0;
}

export async function reclassifyUsLeads(campaignId: string): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc('us_classify_lead_rows', { p_campaign_id: campaignId });
  if (error) throw new Error('No se pudo clasificar la lista.');
  return Number((data as { classified?: number })?.classified ?? 0);
}

export async function addUsToDnc(leadId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc('us_mark_dnc', { p_lead_id: leadId });
  if (error) throw new Error(error.message || 'No se pudo agregar el número a la lista de no llamar.');
}

export async function saveUsSmsConsent(leadId: string, mobile: string, consent: boolean): Promise<void> {
  const { error } = await getSupabaseClient().rpc('us_sms_consent', {
    p_lead_id: leadId,
    p_mobile: mobile,
    p_consent: consent,
  });
  if (error) throw new Error(error.message || 'No se pudo guardar el permiso de SMS.');
}

export async function prepareUsSample(prospectId: string): Promise<{ preview_token: string; reused: boolean }> {
  const { data, error } = await getSupabaseClient().rpc('us_prepare_sample', { p_prospect_id: prospectId });
  if (error) throw new Error(error.message || 'No se pudo preparar la muestra.');
  const value = (Array.isArray(data) ? data[0] : data) as { draft_id: string; preview_token: string; reused: boolean };
  return { preview_token: value.preview_token, reused: value.reused };
}

export async function resolveUsCallback(id: string, status: string, reason = ''): Promise<void> {
  const { error } = await getSupabaseClient().rpc('resolve_us_callback', {
    p_callback_id: id,
    p_status: status,
    p_reason: reason,
  });
  if (error) throw new Error(error.message || 'No se pudo resolver la devolución.');
}

/** `localTime` is the datetime-local value as typed: the business's own clock, not Costa Rica's. */
export async function rescheduleUsCallback(id: string, localTime: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc('reschedule_us_callback', {
    p_callback_id: id,
    p_local: localTime,
  });
  if (error) throw new Error(error.message || 'No se pudo reagendar la devolución.');
}
