import { useCallback, useEffect, useRef, useState } from 'react';
import { useAsync } from '@/app/useAsync';
import type { GmailSyncStatus } from '@/features/admin/models/gmailSync';
import { changeGmailSync, fetchGmailSyncStatus } from '@/features/admin/services/gmailSyncService';

const GMAIL_SYNC_REFRESH_MS = 15_000;
const REFRESH_ERROR = 'No se pudo actualizar el estado. Reintentando…';

export function useGmailSync() {
  const { state, reload, updateData } = useAsync<GmailSyncStatus>(fetchGmailSyncStatus, []);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const writeSequence = useRef(0);

  const apply = useCallback(
    async (change: Parameters<typeof changeGmailSync>[0]) => {
      const sequence = ++writeSequence.current;
      setBusy(true);
      setActionError(null);
      try {
        const next = await changeGmailSync(change);
        updateData(() => next);
        return true;
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'No se pudo guardar el cambio.');
        return false;
      } finally {
        if (sequence === writeSequence.current) setBusy(false);
      }
    },
    [updateData]
  );

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refresh = () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      const sequence = writeSequence.current;
      fetchGmailSyncStatus()
        .then((next) => {
          if (!active || sequence !== writeSequence.current) return;
          updateData(() => next);
          setRefreshError(null);
        })
        .catch(() => {
          if (active) setRefreshError(REFRESH_ERROR);
        })
        .finally(() => {
          inFlight = false;
        });
    };
    const timer = window.setInterval(refresh, GMAIL_SYNC_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [updateData]);

  const setRunning = useCallback(
    (running: boolean) => {
      if (state.status !== 'ready') return Promise.resolve(false);
      return apply({ running, importFrom: null });
    },
    [apply, state.status]
  );

  const setImportFrom = useCallback(
    (importFrom: string) =>
      apply({ running: state.status === 'ready' && state.data.isRunning, importFrom }),
    [apply, state]
  );

  return { state, reload, busy, actionError, refreshError, setRunning, setImportFrom };
}
