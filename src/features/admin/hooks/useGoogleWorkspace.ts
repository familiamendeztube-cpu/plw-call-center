import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAsync } from '@/app/useAsync';
import {
  GOOGLE_RESULT_NOTICES,
  type GoogleConnection,
  type GoogleWorkspaceStatus,
} from '@/features/admin/models/googleWorkspace';
import {
  disconnectGoogleWorkspace,
  fetchGoogleWorkspaceStatus,
  startGoogleAuthorization,
  verifyGoogleConnection,
} from '@/features/admin/services/googleWorkspaceService';

export type GoogleBusyAction = 'start' | 'verify' | 'disconnect';

export interface GoogleNotice {
  tone: 'success' | 'error';
  message: string;
}

export function useGoogleWorkspace() {
  const { state, reload, updateData } = useAsync<GoogleWorkspaceStatus>(
    fetchGoogleWorkspaceStatus,
    []
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [notice, setNotice] = useState<GoogleNotice | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<GoogleBusyAction | null>(null);

  useEffect(() => {
    const outcome = searchParams.get('google');
    if (!outcome) return;
    setNotice(GOOGLE_RESULT_NOTICES[outcome] ?? null);
    const next = new URLSearchParams(searchParams);
    next.delete('google');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const applyConnection = useCallback(
    (connection: GoogleConnection) => {
      updateData((current) => ({ ...current, connection }));
    },
    [updateData]
  );

  const connect = useCallback(async () => {
    setBusy('start');
    setActionError(null);
    try {
      window.location.assign(await startGoogleAuthorization());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo iniciar la conexión.');
      setBusy(null);
    }
  }, []);

  const verify = useCallback(async () => {
    setBusy('verify');
    setActionError(null);
    setNotice(null);
    try {
      const result = await verifyGoogleConnection();
      applyConnection(result.connection);
      setNotice(
        result.verified
          ? {
              tone: 'success',
              message: 'Conexión verificada. Google renovó el acceso correctamente.',
            }
          : { tone: 'error', message: result.message ?? 'No se pudo verificar la conexión.' }
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo verificar la conexión.');
    } finally {
      setBusy(null);
    }
  }, [applyConnection]);

  const disconnect = useCallback(async () => {
    setBusy('disconnect');
    setActionError(null);
    setNotice(null);
    try {
      const result = await disconnectGoogleWorkspace();
      applyConnection(result.connection);
      setNotice({ tone: result.providerRevoked ? 'success' : 'error', message: result.message });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo desconectar la cuenta.');
    } finally {
      setBusy(null);
    }
  }, [applyConnection]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return { state, reload, notice, dismissNotice, actionError, busy, connect, verify, disconnect };
}
