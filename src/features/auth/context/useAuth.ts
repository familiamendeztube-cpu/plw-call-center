import { createContext, useContext } from 'react';
import type {
  AdminSignInRequest,
  AgentSignInRequest,
  DeviceEnrollmentRequest,
  OwnerSetupRequest,
  OwnerSetupState,
} from '@/features/auth/services/authService';
import type { Session } from '@/features/auth/models/session';

export interface AuthContextValue {
  session: Session | null;
  notice: string | null;
  deviceRequired: boolean;
  signInAgent: (request: AgentSignInRequest) => Promise<string | null>;
  signInAdmin: (request: AdminSignInRequest) => Promise<string | null>;
  enrollDevice: (request: DeviceEnrollmentRequest) => Promise<string | null>;
  getOwnerSetupState: () => Promise<OwnerSetupState | null>;
  completeOwnerSetup: (request: OwnerSetupRequest) => Promise<string | null>;
  signOut: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth debe usarse dentro de AuthProvider.');
  }
  return value;
}
