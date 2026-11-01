export const GOOGLE_MAILBOX_ADDRESS = 'Plw@professionallatinoworker2026.com';

export const GOOGLE_CONNECTED_LABEL = 'Google autorizado · Sincronización pendiente';

export type GoogleConnectionStatus = 'disconnected' | 'connected' | 'error';

export interface GooglePermissions {
  gmailRead: boolean;
  gmailSend: boolean;
}

export interface GoogleConnection {
  status: GoogleConnectionStatus;
  connectedAccount: string | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  permissions: GooglePermissions;
  fullyAuthorized: boolean;
}

export interface GoogleVerification {
  verified: boolean;
  message: string | null;
  connection: GoogleConnection;
}

export interface GoogleDisconnection {
  providerRevoked: boolean;
  message: string;
  connection: GoogleConnection;
}

export interface GoogleWorkspaceStatus {
  configured: boolean;
  missing: string[];
  callbackUrl: string;
  mailbox: string;
  connection: GoogleConnection;
}

const CONNECTION_STATUSES: readonly GoogleConnectionStatus[] = [
  'disconnected',
  'connected',
  'error',
];

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseGoogleConnection(value: unknown): GoogleConnection | null {
  if (!isRecord(value) || !isRecord(value.permissions)) return null;
  const { permissions } = value;
  if (
    !CONNECTION_STATUSES.includes(value.status as GoogleConnectionStatus) ||
    !isNullableString(value.connectedAccount) ||
    !isNullableString(value.connectedAt) ||
    !isNullableString(value.lastVerifiedAt) ||
    !isNullableString(value.lastError) ||
    typeof permissions.gmailRead !== 'boolean' ||
    typeof permissions.gmailSend !== 'boolean' ||
    typeof value.fullyAuthorized !== 'boolean'
  ) {
    return null;
  }
  return {
    status: value.status as GoogleConnectionStatus,
    connectedAccount: value.connectedAccount,
    connectedAt: value.connectedAt,
    lastVerifiedAt: value.lastVerifiedAt,
    lastError: value.lastError,
    permissions: { gmailRead: permissions.gmailRead, gmailSend: permissions.gmailSend },
    fullyAuthorized: value.fullyAuthorized,
  };
}

export function parseGoogleWorkspaceStatus(value: unknown): GoogleWorkspaceStatus | null {
  if (!isRecord(value)) return null;
  const connection = parseGoogleConnection(value.connection);
  if (
    typeof value.configured !== 'boolean' ||
    !Array.isArray(value.missing) ||
    !value.missing.every((item) => typeof item === 'string') ||
    typeof value.callbackUrl !== 'string' ||
    typeof value.mailbox !== 'string' ||
    !connection
  ) {
    return null;
  }
  return {
    configured: value.configured,
    missing: value.missing as string[],
    callbackUrl: value.callbackUrl,
    mailbox: value.mailbox,
    connection,
  };
}

export function googleStatusLabel(status: GoogleWorkspaceStatus): string {
  if (!status.configured) return 'Pendiente de configuración';
  switch (status.connection.status) {
    case 'connected':
      return GOOGLE_CONNECTED_LABEL;
    case 'error':
      return 'Requiere reconexión';
    case 'disconnected':
      return 'Sin conectar';
  }
}

export const GOOGLE_RESULT_NOTICES: Record<string, { tone: 'success' | 'error'; message: string }> =
  {
    connected: {
      tone: 'success',
      message:
        'Cuenta de Google autorizada. La sincronización de correos se activará en la siguiente etapa.',
    },
    denied: {
      tone: 'error',
      message: 'Cancelaste la autorización en Google. La conexión no cambió.',
    },
    'wrong-mailbox': {
      tone: 'error',
      message:
        'Google autorizó otra cuenta. Autoriza la cuenta que tiene acceso al buzón Plw@professionallatinoworker2026.com. Si ese buzón es un alias o un grupo de Google, autoriza con la cuenta principal que lo administra.',
    },
    'consent-required': {
      tone: 'error',
      message:
        'Google no entregó acceso sin conexión. Vuelve a conectar y acepta todos los permisos.',
    },
    'exchange-failed': {
      tone: 'error',
      message: 'No se pudo completar la autorización con Google. Intenta de nuevo.',
    },
    'state-invalid': {
      tone: 'error',
      message: 'La autorización venció o ya fue utilizada. Inicia la conexión de nuevo.',
    },
    'access-denied': {
      tone: 'error',
      message: 'Tu sesión de administrador ya no permite completar la conexión.',
    },
    superseded: {
      tone: 'error',
      message:
        'La conexión se desconectó mientras Google respondía. La cuenta sigue desconectada; inicia la conexión de nuevo si quieres volver a conectarla.',
    },
    'not-configured': {
      tone: 'error',
      message: 'Falta configuración en el servidor para conectar Google Workspace.',
    },
    'permissions-missing': {
      tone: 'error',
      message:
        'Google no concedió todos los permisos de Gmail. Vuelve a conectar la cuenta y acepta la lectura y el envío de correos.',
    },
    failed: {
      tone: 'error',
      message: 'No se pudo completar la conexión con Google. Intenta de nuevo.',
    },
  };
