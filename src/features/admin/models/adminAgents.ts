import { isAgentId, type AgentId } from '@/features/auth/models/agent';
import { PIN_LENGTH } from '@/features/auth/models/demoAccess';

export const CAPACITY_MAX = 200;
export const ENROLLMENT_CODE_MINUTES = 15;

export interface AdminAgent {
  id: AgentId;
  displayName: string;
  isEnabled: boolean;
  maxActiveProspects: number | null;
  hasPin: boolean;
}

export interface AgentProfileInput {
  displayName: string;
  isEnabled: boolean;
  maxActiveProspects: number | null;
}

export interface OfficeEnrollmentCode {
  code: string;
  label: string;
}

type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseAdminAgents(payload: unknown): AdminAgent[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.agents)) return null;
  const agents: AdminAgent[] = [];
  for (const row of payload.agents) {
    if (!isRecord(row)) return null;
    const { id, displayName, isEnabled, maxActiveProspects, hasPin } = row;
    if (
      typeof id !== 'string' ||
      !isAgentId(id) ||
      typeof displayName !== 'string' ||
      typeof isEnabled !== 'boolean' ||
      typeof hasPin !== 'boolean' ||
      !(maxActiveProspects === null || typeof maxActiveProspects === 'number')
    ) {
      return null;
    }
    agents.push({ id, displayName, isEnabled, maxActiveProspects, hasPin });
  }
  return agents;
}

export function parseOfficeEnrollmentCode(payload: unknown): OfficeEnrollmentCode | null {
  if (!isRecord(payload) || typeof payload.code !== 'string' || typeof payload.label !== 'string') {
    return null;
  }
  return { code: payload.code, label: payload.label };
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^[0-9]{${PIN_LENGTH}}$`).test(pin);
}

export function validateAgentProfile(
  displayName: string,
  capacityText: string,
  isEnabled: boolean
): ValidationResult<AgentProfileInput> {
  const name = displayName.trim();
  if (name.length < 1 || name.length > 60) {
    return { ok: false, message: 'El nombre debe tener entre 1 y 60 caracteres.' };
  }

  const capacity = capacityText.trim();
  if (capacity === '') {
    return { ok: true, value: { displayName: name, isEnabled, maxActiveProspects: null } };
  }
  const parsed = Number(capacity);
  if (!/^[0-9]+$/.test(capacity) || !Number.isInteger(parsed) || parsed > CAPACITY_MAX) {
    return {
      ok: false,
      message: `El límite debe ser un número entero entre 0 y ${CAPACITY_MAX}, o quedar vacío.`,
    };
  }
  return { ok: true, value: { displayName: name, isEnabled, maxActiveProspects: parsed } };
}
