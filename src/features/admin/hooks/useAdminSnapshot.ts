import { useCallback, useEffect } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import { useAsync } from '@/app/useAsync';
import type { AdminSnapshot } from '@/features/admin/models/overview';

const SNAPSHOT_REFRESH_MS = 30_000;

export function useAdminSnapshot() {
  const services = useAppServices();
  const load = useCallback(async (): Promise<AdminSnapshot> => {
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
  const result = useAsync(load, [load]);
  const { updateData } = result;

  /** Reloads in place: open dialogs, filters and scroll position stay. */
  const refresh = useCallback(() => {
    load()
      .then((data) => updateData(() => data))
      .catch(() => undefined);
  }, [load, updateData]);

  // Who is on a call or offline changes by the minute.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = window.setInterval(tick, SNAPSHOT_REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  return { ...result, refresh };
}
