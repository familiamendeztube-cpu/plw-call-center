import { useCallback, useEffect, useState } from 'react';
import type { AdminAgent } from '@/features/admin/models/adminAgents';
import { listAdminAgents } from '@/features/admin/services/adminAgentService';

export type AdminAgentsState =
  | { status: 'loading' }
  | { status: 'ready'; agents: AdminAgent[] }
  | { status: 'error'; message: string };

const LOAD_FAILURE = 'No se pudieron cargar los agentes. Intente de nuevo.';

export function useAdminAgents() {
  const [state, setState] = useState<AdminAgentsState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const agents = await listAdminAgents();
      setState({ status: 'ready', agents });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : LOAD_FAILURE,
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
