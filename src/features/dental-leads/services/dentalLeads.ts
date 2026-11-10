import { getSupabaseClient } from '@/integrations/supabase/client';
import type { DentalCampaign, DentalLead, DentalStatus } from '../models/dentalLead';
const COLUMNS =
  'id,campaign_id,phone,business_name,contact_name,province,canton,address,source_url,source_name,source_checked_at,verification,owner_staff_id,status,notes,updated_at';
export async function loadDentalData(signal: AbortSignal) {
  const client = getSupabaseClient();
  const { data: campaigns, error } = await client
    .from('dental_campaigns')
    .select(
      'id,name,planned_start_at,timezone,concurrent_per_agent,automation_status,readiness_note'
    )
    .order('created_at', { ascending: false })
    .abortSignal(signal);
  if (error) throw new Error('No se pudo cargar la campaña dental.');
  const leads: DentalLead[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await client
      .from('dental_leads')
      .select(COLUMNS)
      .order('id')
      .range(offset, offset + 999)
      .abortSignal(signal);
    if (result.error) throw new Error('No se pudo cargar la lista de dentistas.');
    leads.push(...(result.data as DentalLead[]));
    if (result.data.length < 1000) break;
  }
  return { campaigns: campaigns as DentalCampaign[], leads };
}
export async function assignDentalLeads(campaignId: string, staffIds: string[]) {
  const { data, error } = await getSupabaseClient().rpc('assign_dental_leads', {
    p_campaign_id: campaignId,
    p_staff_ids: staffIds,
  });
  if (error) throw new Error('No se pudo asignar. Verifique que ambos agentes estén activos.');
  return Number(data);
}
export async function saveDentalLead(id: string, status: DentalStatus, notes: string) {
  const { error } = await getSupabaseClient().rpc('update_dental_lead', {
    p_id: id,
    p_status: status,
    p_notes: notes,
  });
  if (error) throw new Error('No se pudo guardar. Revise la asignación y la lista de no llamar.');
}
