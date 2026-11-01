import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/context/useAuth';
import {
  OwnerSetupScreen,
  OwnerSetupUnavailable,
} from '@/features/auth/components/OwnerSetupScreen';
import { StatusMessage } from '@/components/ui/StatusMessage';
import type { OwnerSetupState } from '@/features/auth/services/authService';

type LoadState =
  { status: 'loading' } | { status: 'ready'; state: OwnerSetupState } | { status: 'failed' };

export function OwnerSetupPage() {
  const { session, getOwnerSetupState, completeOwnerSetup } = useAuth();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getOwnerSetupState().then((state) => {
      if (!active) return;
      setLoad(state ? { status: 'ready', state } : { status: 'failed' });
    });
    return () => {
      active = false;
    };
  }, [getOwnerSetupState, attempt]);

  const retry = useCallback(() => {
    setLoad({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  if (session) {
    return <Navigate to={session.role === 'admin' ? '/admin/resumen' : '/bandeja'} replace />;
  }

  if (load.status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4">
        <StatusMessage tone="loading" title="Verificando la configuración..." />
      </div>
    );
  }

  if (load.status === 'failed') {
    return <OwnerSetupUnavailable onRetry={retry} />;
  }

  if (load.state.setupComplete) {
    return <Navigate to="/acceso-administrador" replace />;
  }

  if (!load.state.setupAvailable) {
    return <OwnerSetupUnavailable onRetry={null} />;
  }

  return (
    <OwnerSetupScreen
      onSubmit={(passcode, computerName) => completeOwnerSetup({ passcode, computerName })}
    />
  );
}
