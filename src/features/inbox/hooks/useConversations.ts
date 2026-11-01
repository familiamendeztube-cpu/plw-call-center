import { useEffect } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import { useAsync } from '@/app/useAsync';
import type { AgentId } from '@/features/auth/models/agent';

const INBOX_REFRESH_MS = 30_000;

export function useConversations(agentId: AgentId) {
  const { inbox } = useAppServices();
  const result = useAsync(() => inbox.listConversations(agentId), [inbox, agentId]);
  const { updateData } = result;

  useEffect(() => {
    let inFlight = false;
    const refresh = () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      inbox
        .listConversations(agentId)
        .then((data) => updateData(() => data))
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    const timer = window.setInterval(refresh, INBOX_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [inbox, agentId, updateData]);

  return result;
}
