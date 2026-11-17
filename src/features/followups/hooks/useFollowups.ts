import { useEffect } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import { useAsync } from '@/app/useAsync';
import type { AgentId } from '@/features/auth/models/agent';

const FOLLOWUP_REFRESH_MS = 60_000;

export function useFollowups(agentId: AgentId | null) {
  const { followups } = useAppServices();
  const result = useAsync(() => followups.listFollowups(agentId), [followups, agentId]);
  const { updateData } = result;

  // Quietly, like the customer list: a follow-up that comes due moves to "Vencidos" on its own.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      followups
        .listFollowups(agentId)
        .then((data) => updateData(() => data))
        .catch(() => undefined);
    };
    const timer = window.setInterval(refresh, FOLLOWUP_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [followups, agentId, updateData]);

  return result;
}
