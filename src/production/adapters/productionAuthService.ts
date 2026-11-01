import { isAgentId } from '@/features/auth/models/agent';
import type { Session } from '@/features/auth/models/session';
import type {
  AdminSignInRequest,
  AgentSignInRequest,
  AuthResult,
  AuthService,
  DeviceEnrollmentRequest,
  OwnerSetupRequest,
  OwnerSetupState,
  RestoreResult,
} from '@/features/auth/services/authService';
import {
  getSupabaseClient,
  supabaseAnonKeyValue,
  supabaseFunctionsUrl,
} from '@/integrations/supabase/client';

const ADMIN_STAFF_ID = 'admin-1';
const ADMIN_PASSCODE_MIN_LENGTH = 12;
const DEVICE_TOKEN_KEY = 'plw.office-device-token';
const GENERIC_SIGN_IN_FAILURE = 'No fue posible ingresar. Revisa tus datos e intenta de nuevo.';
const CONNECTION_FAILURE = 'No se pudo conectar. Intenta de nuevo.';
const ACCESS_UNAVAILABLE = 'Tu acceso no está disponible. Contacta al administrador.';
const SESSION_ENDED = 'Tu sesión venció. Ingresa de nuevo para continuar.';

function getOrCreateDeviceToken(): string {
  const existing = window.localStorage.getItem(DEVICE_TOKEN_KEY);
  if (existing && existing.length >= 16) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  window.localStorage.setItem(DEVICE_TOKEN_KEY, token);
  return token;
}

async function callEdgeFunction(
  name: string,
  body: Record<string, unknown>,
  accessToken?: string
): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const response = await fetch(`${supabaseFunctionsUrl}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKeyValue,
      Authorization: `Bearer ${accessToken ?? supabaseAnonKeyValue}`,
    },
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json().catch(() => null);
  const record =
    data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  return { status: response.status, data: record };
}

function callStaffAuth(body: Record<string, unknown>, accessToken?: string) {
  return callEdgeFunction('staff-auth', body, accessToken);
}

function callOwnerSetup(body: Record<string, unknown>) {
  return callEdgeFunction('owner-setup', body);
}

interface OkLogin {
  accessToken: string;
  refreshToken: string;
  staffId: string;
  role: string;
  displayName: string;
}

function readOkLogin(data: Record<string, unknown> | null): OkLogin | null {
  const session = data?.session as Record<string, unknown> | undefined;
  const staff = data?.staff as Record<string, unknown> | undefined;
  if (
    !session ||
    !staff ||
    typeof session.accessToken !== 'string' ||
    typeof session.refreshToken !== 'string' ||
    typeof staff.id !== 'string' ||
    typeof staff.role !== 'string' ||
    typeof staff.displayName !== 'string'
  ) {
    return null;
  }
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    staffId: staff.id,
    role: staff.role,
    displayName: staff.displayName,
  };
}

function toSession(staffId: string, role: string, displayName: string): Session | null {
  if (role === 'agent' && isAgentId(staffId)) {
    return { role: 'agent', source: 'production', agentId: staffId, displayName };
  }
  if (role === 'admin' && staffId === ADMIN_STAFF_ID) {
    return { role: 'admin', source: 'production', displayName };
  }
  return null;
}

function readStaffProfile(
  row: unknown
): { id: string; role: string; displayName: string; isEnabled: boolean } | null {
  if (row === null || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.role !== 'string' ||
    typeof record.display_name !== 'string' ||
    typeof record.is_enabled !== 'boolean'
  ) {
    return null;
  }
  return {
    id: record.id,
    role: record.role,
    displayName: record.display_name,
    isEnabled: record.is_enabled,
  };
}

export function createProductionAuthService(): AuthService {
  let signingOut = false;

  async function completeLogin(
    staffId: string,
    expectedRole: 'agent' | 'admin',
    data: Record<string, unknown> | null
  ): Promise<AuthResult> {
    const login = readOkLogin(data);
    const session = login ? toSession(login.staffId, login.role, login.displayName) : null;
    if (!login || !session || session.role !== expectedRole || login.staffId !== staffId) {
      return { ok: false, message: GENERIC_SIGN_IN_FAILURE, deviceRequired: false };
    }
    const { error } = await getSupabaseClient().auth.setSession({
      access_token: login.accessToken,
      refresh_token: login.refreshToken,
    });
    if (error) {
      return { ok: false, message: CONNECTION_FAILURE, deviceRequired: false };
    }
    return { ok: true, session };
  }

  async function login(
    staffId: string,
    kind: 'pin' | 'passcode',
    secret: string,
    expectedRole: 'agent' | 'admin'
  ): Promise<AuthResult> {
    let response: Awaited<ReturnType<typeof callStaffAuth>>;
    try {
      response = await callStaffAuth({
        action: 'login',
        staffId,
        kind,
        secret,
        deviceToken: getOrCreateDeviceToken(),
      });
    } catch {
      return { ok: false, message: CONNECTION_FAILURE, deviceRequired: false };
    }

    const status = response.data?.status;
    if (status === 'device_required') {
      return {
        ok: false,
        message:
          'Este equipo aún no está registrado. Solicita un código de registro al administrador.',
        deviceRequired: true,
      };
    }
    if (response.status === 500) {
      return { ok: false, message: CONNECTION_FAILURE, deviceRequired: false };
    }
    if (status !== 'ok') {
      return { ok: false, message: GENERIC_SIGN_IN_FAILURE, deviceRequired: false };
    }
    return completeLogin(staffId, expectedRole, response.data);
  }

  return {
    async signInAgent({ agentId, pin }: AgentSignInRequest) {
      return login(agentId, 'pin', pin, 'agent');
    },

    async signInAdmin({ passcode }: AdminSignInRequest) {
      if (passcode.length < ADMIN_PASSCODE_MIN_LENGTH) {
        return {
          ok: false,
          message: `La contraseña debe tener al menos ${ADMIN_PASSCODE_MIN_LENGTH} caracteres.`,
          deviceRequired: false,
        };
      }
      return login(ADMIN_STAFF_ID, 'passcode', passcode, 'admin');
    },

    async restoreSession(): Promise<RestoreResult> {
      const client = getSupabaseClient();
      const { data, error } = await client.auth.getSession();
      if (error) {
        return { session: null, notice: CONNECTION_FAILURE };
      }
      if (!data.session) {
        return { session: null, notice: null };
      }

      const { data: row, error: profileError } = await client
        .from('staff_profiles')
        .select('id, role, display_name, is_enabled')
        .eq('auth_user_id', data.session.user.id)
        .maybeSingle();
      if (profileError) {
        return { session: null, notice: CONNECTION_FAILURE };
      }

      const profile = readStaffProfile(row);
      if (!profile || !profile.isEnabled) {
        signingOut = true;
        await client.auth.signOut();
        signingOut = false;
        return { session: null, notice: profile ? ACCESS_UNAVAILABLE : SESSION_ENDED };
      }

      const session = toSession(profile.id, profile.role, profile.displayName);
      if (!session) {
        signingOut = true;
        await client.auth.signOut();
        signingOut = false;
        return { session: null, notice: ACCESS_UNAVAILABLE };
      }
      return { session, notice: null };
    },

    async enrollDevice({ code, label }: DeviceEnrollmentRequest) {
      try {
        const response = await callStaffAuth({
          action: 'enroll_device',
          code,
          label,
          deviceToken: getOrCreateDeviceToken(),
        });
        if (response.data?.status === 'ok') return null;
        return 'El código no es válido o ya venció. Solicita uno nuevo al administrador.';
      } catch {
        return CONNECTION_FAILURE;
      }
    },

    async getOwnerSetupState(): Promise<OwnerSetupState | null> {
      try {
        const response = await callOwnerSetup({ action: 'status' });
        const data = response.data;
        if (
          response.status !== 200 ||
          typeof data?.setupComplete !== 'boolean' ||
          typeof data?.setupAvailable !== 'boolean'
        ) {
          return null;
        }
        return { setupComplete: data.setupComplete, setupAvailable: data.setupAvailable };
      } catch {
        return null;
      }
    },

    async completeOwnerSetup({ passcode, computerName }: OwnerSetupRequest) {
      let response: Awaited<ReturnType<typeof callOwnerSetup>>;
      try {
        response = await callOwnerSetup({
          action: 'setup',
          passcode,
          computerName,
          deviceToken: getOrCreateDeviceToken(),
        });
      } catch {
        return { ok: false, message: CONNECTION_FAILURE, deviceRequired: false };
      }

      const status = response.data?.status;
      if (status === 'ok') {
        return login(ADMIN_STAFF_ID, 'passcode', passcode, 'admin');
      }
      if (status === 'already_completed') {
        return {
          ok: false,
          message: 'La configuración inicial ya se completó. Ingrese con su contraseña.',
          deviceRequired: false,
        };
      }
      if (status === 'throttled') {
        return {
          ok: false,
          message: 'Demasiados intentos. Espere 15 minutos e intente de nuevo.',
          deviceRequired: false,
        };
      }
      if (status === 'invalid' && response.status === 403) {
        return {
          ok: false,
          message: 'La contraseña no es correcta. Revise e intente de nuevo.',
          deviceRequired: false,
        };
      }
      if (status === 'unavailable') {
        return {
          ok: false,
          message: 'La configuración inicial no está disponible en este momento.',
          deviceRequired: false,
        };
      }
      return { ok: false, message: CONNECTION_FAILURE, deviceRequired: false };
    },

    async signOut() {
      const client = getSupabaseClient();
      signingOut = true;
      try {
        const { data } = await client.auth.getSession();
        if (data.session) {
          await callStaffAuth({ action: 'logout' }, data.session.access_token).catch(() => null);
        }
        await client.auth.signOut();
      } finally {
        signingOut = false;
      }
    },

    onSessionEnded(listener) {
      const { data } = getSupabaseClient().auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT' && !signingOut) {
          listener(SESSION_ENDED);
        }
      });
      return () => data.subscription.unsubscribe();
    },
  };
}
