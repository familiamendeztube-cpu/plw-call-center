import type { AgentId } from '@/features/auth/models/agent';
import type { Session } from '@/features/auth/models/session';

export interface AgentSignInRequest {
  agentId: AgentId;
  pin: string;
}

export interface AdminSignInRequest {
  passcode: string;
}

export interface DeviceEnrollmentRequest {
  code: string;
  label: string;
}

export interface OwnerSetupRequest {
  passcode: string;
  computerName: string;
}

export interface OwnerSetupState {
  setupComplete: boolean;
  setupAvailable: boolean;
}

export type AuthResult =
  { ok: true; session: Session } | { ok: false; message: string; deviceRequired: boolean };

export interface RestoreResult {
  session: Session | null;
  notice: string | null;
}

export interface AuthService {
  signInAgent(request: AgentSignInRequest): Promise<AuthResult>;
  signInAdmin(request: AdminSignInRequest): Promise<AuthResult>;
  restoreSession(): Promise<RestoreResult>;
  enrollDevice(request: DeviceEnrollmentRequest): Promise<string | null>;
  getOwnerSetupState(): Promise<OwnerSetupState | null>;
  completeOwnerSetup(request: OwnerSetupRequest): Promise<AuthResult>;
  signOut(): Promise<void>;
  onSessionEnded(listener: (notice: string | null) => void): () => void;
}
