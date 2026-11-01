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
}
