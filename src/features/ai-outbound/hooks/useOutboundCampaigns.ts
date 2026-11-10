import { useAsync } from '@/app/useAsync';
import {
  listCampaigns,
  listLeads,
} from '@/features/ai-outbound/services/outboundCampaigns';

export function useOutboundCampaigns() {
  return useAsync(listCampaigns, []);
}

export function useCampaignLeads(campaignId: string) {
  return useAsync(() => listLeads(campaignId), [campaignId]);
}
