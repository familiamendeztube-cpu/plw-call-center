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
  created_at: string;
}

const CAMPAIGN_COLUMNS = 'id, name, purpose, created_at';
const LEAD_COLUMNS = 'id, campaign_id, phone, contact_name, business_name, created_at';

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
