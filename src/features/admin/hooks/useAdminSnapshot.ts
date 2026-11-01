import { useAppServices } from '@/app/ServicesContext';
import { useAsync } from '@/app/useAsync';
import type { AdminSnapshot } from '@/features/admin/models/overview';

export function useAdminSnapshot() {
  const services = useAppServices();

  return useAsync<AdminSnapshot>(async () => {
    const [agents, presence, prospects, conversations, followups, activity] = await Promise.all([
      services.agents.listAgents(),
      services.presence.listPresence(),
      services.leads.listProspects(),
      services.inbox.listConversations(null),
      services.followups.listFollowups(null),
      services.presence.listActivity(null),
    ]);
    return { agents, presence, prospects, conversations, followups, activity };
  }, [services]);
}
