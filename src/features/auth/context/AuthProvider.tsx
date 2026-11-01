import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { AuthContext, type AuthContextValue } from '@/features/auth/context/useAuth';
import type { Session } from '@/features/auth/models/session';
import type {
  AdminSignInRequest,
  AgentSignInRequest,
  AuthResult,
  AuthService,
  OwnerSetupRequest,
} from '@/features/auth/services/authService';

interface AuthProviderProps {
  authService: AuthService;
  children: ReactNode;
}

export function AuthProvider({ authService, children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deviceRequired, setDeviceRequired] = useState(false);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let active = true;
    authService
      .restoreSession()
      .then((result) => {
        if (!active) return;
        setSession(result.session);
        setNotice(result.notice);
      })
      .catch(() => {
        if (active) setNotice('No se pudo restaurar tu sesión. Ingresa de nuevo.');
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    const unsubscribe = authService.onSessionEnded((message) => {
      setSession(null);
      setNotice(message);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [authService]);

  const applyResult = useCallback((result: AuthResult): string | null => {
    if (result.ok) {
      setSession(result.session);
      setNotice(null);
      setDeviceRequired(false);
      return null;
    }
    setDeviceRequired(result.deviceRequired);
    return result.message;
  }, []);

  const signInAgent = useCallback<AuthContextValue['signInAgent']>(
    async (request: AgentSignInRequest) => applyResult(await authService.signInAgent(request)),
    [authService, applyResult]
  );

  const signInAdmin = useCallback<AuthContextValue['signInAdmin']>(
    async (request: AdminSignInRequest) => applyResult(await authService.signInAdmin(request)),
    [authService, applyResult]
  );

  const enrollDevice = useCallback<AuthContextValue['enrollDevice']>(
    async (request) => {
      const message = await authService.enrollDevice(request);
      if (message === null) setDeviceRequired(false);
      return message;
    },
    [authService]
  );

  const getOwnerSetupState = useCallback<AuthContextValue['getOwnerSetupState']>(
    () => authService.getOwnerSetupState(),
    [authService]
  );

  const completeOwnerSetup = useCallback<AuthContextValue['completeOwnerSetup']>(
    async (request: OwnerSetupRequest) =>
      applyResult(await authService.completeOwnerSetup(request)),
    [authService, applyResult]
  );

  const signOut = useCallback(() => {
    setSession(null);
    setNotice(null);
    void authService.signOut();
  }, [authService]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      notice,
      deviceRequired,
      signInAgent,
      signInAdmin,
      enrollDevice,
      getOwnerSetupState,
      completeOwnerSetup,
      signOut,
    }),
    [
      session,
      notice,
      deviceRequired,
      signInAgent,
      signInAdmin,
      enrollDevice,
      getOwnerSetupState,
      completeOwnerSetup,
      signOut,
    ]
  );

  if (restoring) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4">
        <StatusMessage tone="loading" title="Verificando tu sesión..." />
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
