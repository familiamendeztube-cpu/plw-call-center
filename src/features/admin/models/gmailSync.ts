export type GmailSyncPhase = 'idle' | 'listing' | 'incremental';

export interface GmailSyncStatus {
  isRunning: boolean;
  importFrom: string | null;
  phase: GmailSyncPhase;
  leaseActive: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  connected: boolean;
  connectedAccount: string | null;
}

export type GmailSyncState =
  'disconnected' | 'error' | 'paused' | 'importing' | 'waiting' | 'synced';

const PHASES: readonly GmailSyncPhase[] = ['idle', 'listing', 'incremental'];

const LABELS: Record<GmailSyncState, string> = {
  disconnected: 'Sin conectar',
  error: 'Error de sincronización',
  paused: 'En pausa',
  importing: 'Importando correos',
  waiting: 'Esperando la próxima revisión',
  synced: 'Sincronizado',
};

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function parseGmailSyncStatus(value: unknown): GmailSyncStatus | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.isRunning !== 'boolean' ||
    typeof row.connected !== 'boolean' ||
    typeof row.leaseActive !== 'boolean' ||
    !PHASES.includes(row.phase as GmailSyncPhase) ||
    typeof row.consecutiveFailures !== 'number' ||
    !isNullableString(row.importFrom) ||
    !isNullableString(row.lastSuccessAt) ||
    !isNullableString(row.lastError) ||
    !isNullableString(row.lastErrorAt) ||
    !isNullableString(row.connectedAccount)
  ) {
    return null;
  }
  return {
    isRunning: row.isRunning,
    importFrom: row.importFrom,
    phase: row.phase as GmailSyncPhase,
    leaseActive: row.leaseActive,
    lastSuccessAt: row.lastSuccessAt,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt,
    consecutiveFailures: row.consecutiveFailures,
    connected: row.connected,
    connectedAccount: row.connectedAccount,
  };
}

export function gmailSyncState(status: GmailSyncStatus): GmailSyncState {
  if (!status.connected) return 'disconnected';
  if (status.consecutiveFailures > 0) return 'error';
  if (!status.isRunning) return 'paused';
  if (status.leaseActive) return 'importing';
  if (status.phase === 'incremental' && status.lastSuccessAt) return 'synced';
  return 'waiting';
}

export function gmailSyncLabel(status: GmailSyncStatus): string {
  return LABELS[gmailSyncState(status)];
}
