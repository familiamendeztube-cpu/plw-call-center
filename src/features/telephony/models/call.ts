import type { OperationalStatus } from '@/features/presence/models/availability';

export type CallState = 'idle' | 'dialing' | 'ringing' | 'active' | 'on_hold' | 'ended';

export type CallDirection = 'inbound' | 'outbound';

export interface CallSnapshot {
  id: string;
  state: CallState;
  direction: CallDirection;
  remoteNumber: string;
  startedAt: string | null;
  muted: boolean;
  dentalCallId?: string | null;
}

export interface RecentCall {
  id: string;
  remoteNumber: string;
  direction: CallDirection;
  endedAt: string;
  durationSeconds: number;
}

const SAME_CALL_WINDOW_MS = 2 * 60_000;

/**
 * One phone number however it is written, to match calls and customers: Costa Rica keeps its
 * 8 digits (+506 dropped), the US its 10 (+1 dropped). Never the last 8 digits of a US number:
 * 305-555-1234 and 405-555-1234 share them.
 */
export function phoneKey(number: string): string {
  const digits = number.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('506')) return digits.slice(3);
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

export type CallerOrigin = 'us' | 'cr';

export const ORIGIN_LABELS: Record<CallerOrigin, string> = { us: 'EE. UU.', cr: 'Costa Rica' };

/** Where a number is from, by its shape: 8 digits (or 506 + 8) is Costa Rica, 10 (or 1 + 10) the US. */
export function callerOrigin(number: string): CallerOrigin | null {
  const digits = number.replace(/\D/g, '');
  if (/^(506)?[2-8]\d{7}$/.test(digits)) return 'cr';
  if (/^1?[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return 'us';
  return null;
}

/** "EE. UU." / "Costa Rica", or '' when the number has neither shape (an extension, a name). */
export const originLabel = (number: string) => {
  const origin = callerOrigin(number);
  return origin ? ORIGIN_LABELS[origin] : '';
};

/**
 * Calls the server has saved, plus calls that ended in this tab and aren't saved yet.
 * A live call counts as saved once a record with the same number ended within two minutes
 * of it, so each call shows once even before and after the server records it.
 */
export function mergeRecentCalls(
  live: RecentCall[],
  saved: RecentCall[],
  limit = 20
): RecentCall[] {
  const unsaved = live.filter(
    (call) =>
      !saved.some(
        (record) =>
          phoneKey(record.remoteNumber) === phoneKey(call.remoteNumber) &&
          Math.abs(Date.parse(record.endedAt) - Date.parse(call.endedAt)) < SAME_CALL_WINDOW_MS
      )
  );
  return [...unsaved, ...saved]
    .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt))
    .slice(0, limit);
}

export const CALL_STATE_LABELS: Record<CallState, string> = {
  idle: 'Sin llamada',
  dialing: 'Marcando',
  ringing: 'Sonando',
  active: 'En curso',
  on_hold: 'En espera',
  ended: 'Finalizada',
};

// Eight digits starting with 2-8, with or without 506 (Costa Rica lists and the AI dialers).
const COSTA_RICA_NUMBER = /^(?:\+?506)?([2-8]\d{7})$/;
// Agents call only the US (owner, 2026-11-26): 10 digits with or without 1, area and exchange
// starting 2-9, no N11 area codes, no 900/976 premium numbers. The phone server
// (infra/asterisk/telnyx) enforces the same rule; this copy lets the agent see why.
const US_NUMBER = /^1?((?!900|976|[2-9]11)[2-9]\d{2}[2-9]\d{6})$/;
const MAX_DIAL_LENGTH = 20;

const DENTAL_CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The dental call id Ana sends in the SIP header, or null when it is missing or malformed. */
export function dentalCallIdFromHeader(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return DENTAL_CALL_ID.test(trimmed) ? trimmed : null;
}

export function toDialNumber(input: string): string {
  return input.replace(/[^\d*#+]/g, '').slice(0, MAX_DIAL_LENGTH);
}

export function toCostaRicaNumber(input: string): string | null {
  return COSTA_RICA_NUMBER.exec(input.replace(/[\s()-]/g, ''))?.[1] ?? null;
}

/** The number an agent can call, as +1 and 10 digits, or null when it isn't a US number. */
export function toUsNumber(input: string): string | null {
  const national = US_NUMBER.exec(input.replace(/[\s().+-]/g, ''))?.[1];
  return national ? `+1${national}` : null;
}

export function formatCallDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function isCallLive(state: CallState): boolean {
  return state === 'dialing' || state === 'ringing' || state === 'active' || state === 'on_hold';
}

/** What the call buttons can do right now. The full phone and the compact dialer share it. */
export function callButtons(call: CallSnapshot | null, dialNumber: string, registered: boolean) {
  const live = call !== null && isCallLive(call.state);
  const active = call?.state === 'active';
  const onHold = call?.state === 'on_hold';
  return {
    live,
    incoming: call?.direction === 'inbound' && call.state === 'ringing',
    canDial: registered && dialNumber.length > 0 && !live,
    canMute: active,
    canHold: active || onHold,
    canTransfer: active && dialNumber.length > 0,
    onHold,
    muted: Boolean(call?.muted),
  };
}

export function toOperationalStatus(call: CallSnapshot | null): OperationalStatus | null {
  if (!call) {
    return null;
  }
  if (isCallLive(call.state)) {
    return 'in_call';
  }
  return call.state === 'ended' ? 'after_call' : null;
}
