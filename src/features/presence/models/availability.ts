export type Availability = 'active' | 'paused';

export type OperationalStatus = 'in_call' | 'after_call';

export type DisplayStatus = Availability | OperationalStatus;

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  active: 'Activo',
  paused: 'Pausa',
};

export const DISPLAY_STATUS_LABELS: Record<DisplayStatus, string> = {
  active: 'Activo',
  paused: 'Pausa',
  in_call: 'En llamada',
  after_call: 'Gestión posterior',
};

export function resolveDisplayStatus(
  availability: Availability,
  operational: OperationalStatus | null
): DisplayStatus {
  return operational ?? availability;
}

export interface AgentPresence {
  agentId: string;
  availability: Availability;
  updatedAt: string;
  /** On a call right now, as the agent's phone reported it. */
  inCall?: boolean;
  /** The app sends a heartbeat every 30 seconds while it is open. */
  lastHeartbeatAt?: string | null;
}

/** The server's own rule (presence_expiry_seconds): no heartbeat for 90 s means the app is closed. */
const HEARTBEAT_EXPIRY_MS = 90_000;

/** What the administrator sees for an agent: offline beats everything else. */
export function liveStatus(
  presence: AgentPresence | undefined,
  now: number
): DisplayStatus | 'offline' {
  if (!presence) return 'offline';
  // undefined: the source keeps no heartbeats (demo data), so availability is all there is.
  const closed =
    presence.lastHeartbeatAt !== undefined &&
    (presence.lastHeartbeatAt === null ||
      now - Date.parse(presence.lastHeartbeatAt) > HEARTBEAT_EXPIRY_MS);
  if (closed) return 'offline';
  return presence.inCall ? 'in_call' : presence.availability;
}

export const LIVE_STATUS_LABELS: Record<DisplayStatus | 'offline', string> = {
  ...DISPLAY_STATUS_LABELS,
  offline: 'Desconectado',
};
