import { useCallback, useEffect, useState } from 'react';
import { loadDialer } from '../services/dentalDialer';
import type { DentalCall, DentalDialer, DentalRuntime } from '../models/dentalDialer';
export function useDentalDialer(enabled: boolean) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{
    routes: DentalDialer[];
    runtime: DentalRuntime | null;
    calls: DentalCall[];
    loading: boolean;
    error: string;
  }>({ routes: [], runtime: null, calls: [], loading: true, error: '' });
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function update() {
      if (!enabled || busy) return;
      busy = true;
      try {
        const result = await loadDialer(controller.signal);
        if (!controller.signal.aborted) setState({ ...result, loading: false, error: '' });
      } catch (e) {
        if (!controller.signal.aborted)
          setState((s) => ({
            ...s,
            loading: false,
            error: e instanceof Error ? e.message : 'No se pudo actualizar.',
          }));
      } finally {
        busy = false;
      }
    }
    if (!enabled)
      setState((s) => ({
        ...s,
        loading: false,
        error: 'El marcador requiere una sesión de producción.',
      }));
    void update();
    const timer = window.setInterval(() => void update(), 15000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [enabled, version]);
  return { ...state, reload };
}
