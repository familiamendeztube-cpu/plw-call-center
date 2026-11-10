import { useCallback, useEffect, useState } from 'react';
import { loadDentalData } from '../services/dentalLeads';
import type { DentalCampaign, DentalLead } from '../models/dentalLead';
import {
  listEnabledAgents,
  type StaffAgent,
} from '@/features/ai-outbound/services/outboundCampaigns';
export function useDentalLeads(enabled: boolean, admin: boolean) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    leads: DentalLead[];
    campaigns: DentalCampaign[];
    agents: StaffAgent[];
  }>({ loading: true, error: null, leads: [], campaigns: [], agents: [] });
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    if (!enabled) {
      setState({
        loading: false,
        error: 'La búsqueda dental requiere una sesión de producción.',
        leads: [],
        campaigns: [],
        agents: [],
      });
      return () => controller.abort();
    }
    setState((v) => ({ ...v, loading: true, error: null }));
    Promise.all([
      loadDentalData(controller.signal),
      admin ? listEnabledAgents() : Promise.resolve([]),
    ])
      .then(([data, agents]) => {
        if (!controller.signal.aborted) setState({ ...data, agents, loading: false, error: null });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState((v) => ({
            ...v,
            loading: false,
            error: 'No se pudo actualizar la lista dental. Intente nuevamente.',
          }));
      });
    return () => controller.abort();
  }, [revision, enabled, admin]);
  return { ...state, reload };
}
