import { useEffect } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import { useAsync } from '@/app/useAsync';

const PROSPECT_REFRESH_MS = 30_000;

export function useProspects() {
  const { leads } = useAppServices();
  const result = useAsync(() => leads.listProspects(), [leads]);
  const { updateData } = result;

  useEffect(() => {
    let inFlight = false;
    const refresh = () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      leads
        .listProspects()
        .then((data) => updateData(() => data))
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    const timer = window.setInterval(refresh, PROSPECT_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [leads, updateData]);

  return result;
}
