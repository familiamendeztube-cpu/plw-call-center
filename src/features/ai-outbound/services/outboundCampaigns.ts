import { getSupabaseClient } from '@/integrations/supabase/client';
import type { OutboundLeadDraft } from '@/features/ai-outbound/models/outboundLead';

export interface OutboundCampaign {
  id: string;
  name: string;
  purpose: string;
  created_at: string;
}

export interface OutboundLead {
  id: string;
  campaign_id: string;
  phone: string;
  contact_name: string;
  business_name: string;
  business_type: string;
  created_at: string;
}

export interface StaffAgent {
  id: string;
  display_name: string;
  is_enabled: boolean;
}

const CAMPAIGN_COLUMNS = 'id, name, purpose, created_at';
const LEAD_COLUMNS = 'id, campaign_id, phone, contact_name, business_name, business_type, created_at';

export async function listCampaigns(): Promise<OutboundCampaign[]> {
  const { data, error } = await getSupabaseClient()
    .from('ai_outbound_campaigns')
    .select(CAMPAIGN_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw new Error('No se pudieron cargar las campañas.');
  return (data ?? []) as OutboundCampaign[];
}

export async function createCampaign(input: { name: string; purpose: string }): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('ai_outbound_campaigns')
    .insert({ name: input.name, purpose: input.purpose });
  if (error) throw new Error('No se pudo crear la campaña.');
}

export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await getSupabaseClient().from('ai_outbound_campaigns').delete().eq('id', id);
  if (error) throw new Error('No se pudo eliminar la campaña.');
}

export async function listLeads(campaignId: string): Promise<OutboundLead[]> {
  const { data, error } = await getSupabaseClient()
    .from('ai_outbound_leads')
    .select(LEAD_COLUMNS)
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true });
  if (error) throw new Error('No se pudieron cargar los contactos.');
  return (data ?? []) as OutboundLead[];
}

export async function importLeads(campaignId: string, drafts: OutboundLeadDraft[]): Promise<number> {
  const rows = drafts.map((draft) => ({ ...draft, campaign_id: campaignId }));
  const { data, error } = await getSupabaseClient()
    .from('ai_outbound_leads')
    .upsert(rows, { onConflict: 'campaign_id,phone', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error('No se pudieron importar los contactos.');
  return data?.length ?? 0;
}

export async function deleteLead(id: string): Promise<void> {
  const { error } = await getSupabaseClient().from('ai_outbound_leads').delete().eq('id', id);
  if (error) throw new Error('No se pudo eliminar el contacto.');
}

export async function listDoNotCallPhones(): Promise<string[]> {
  const { data, error } = await getSupabaseClient().from('ai_outbound_do_not_call').select('phone');
  if (error) throw new Error('No se pudo cargar la lista de no llamar.');
  return (data ?? []).map((row) => String(row.phone));
}

export async function addToDoNotCall(phone: string, leadId: string): Promise<void> {
  const { error: insertError } = await getSupabaseClient()
    .from('ai_outbound_do_not_call')
    .upsert({ phone, reason: 'Pidió no ser contactado' }, { onConflict: 'phone', ignoreDuplicates: true });
  if (insertError) throw new Error('No se pudo agregar el número a la lista de no llamar.');
  await deleteLead(leadId);
}

export async function listEnabledAgents(): Promise<StaffAgent[]> {
  const { data, error } = await getSupabaseClient()
    .from('staff_profiles')
    .select('id, display_name, is_enabled')
    .eq('role', 'agent')
    .order('display_name', { ascending: true });
  if (error) throw new Error('No se pudo cargar la lista de agentes.');
  return (data ?? []) as StaffAgent[];
}

export async function listCampaignAgentIds(campaignId: string): Promise<string[]> {
  const { data, error } = await getSupabaseClient()
    .from('ai_outbound_campaign_agents')
    .select('staff_id')
    .eq('campaign_id', campaignId);
  if (error) throw new Error('No se pudieron cargar los agentes de la campaña.');
  return (data ?? []).map((row) => String(row.staff_id));
}

export async function setCampaignAgent(campaignId: string, staffId: string, selected: boolean): Promise<void> {
  const client = getSupabaseClient();
  const { error } = selected
    ? await client
        .from('ai_outbound_campaign_agents')
        .upsert({ campaign_id: campaignId, staff_id: staffId }, { onConflict: 'campaign_id,staff_id', ignoreDuplicates: true })
    : await client
        .from('ai_outbound_campaign_agents')
        .delete()
        .eq('campaign_id', campaignId)
        .eq('staff_id', staffId);
  if (error) throw new Error('No se pudo cambiar el agente de la campaña.');
}
