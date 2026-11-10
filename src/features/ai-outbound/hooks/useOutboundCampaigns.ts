import { useAsync } from '@/app/useAsync';
import {
  listCampaigns,
  listCampaignAgentIds,
  listDoNotCallPhones,
  listEnabledAgents,
  listLeads,
} from '@/features/ai-outbound/services/outboundCampaigns';

export function useOutboundCampaigns() {
  return useAsync(listCampaigns, []);
}

export function useCampaignLeads(campaignId: string) {
  return useAsync(() => listLeads(campaignId), [campaignId]);
}

export function useCampaignAgentIds(campaignId: string) {
  return useAsync(() => listCampaignAgentIds(campaignId), [campaignId]);
}

export function useEnabledAgents() {
  return useAsync(listEnabledAgents, []);
}

export function useDoNotCallPhones() {
  return useAsync(listDoNotCallPhones, []);
}
