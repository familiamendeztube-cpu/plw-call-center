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
}

export interface RecentCall {
  id: string;
  remoteNumber: string;
  direction: CallDirection;
  endedAt: string;
  durationSeconds: number;
}

export const CALL_STATE_LABELS: Record<CallState, string> = {
  idle: 'Sin llamada',
  dialing: 'Marcando',
  ringing: 'Sonando',
  active: 'En curso',
  on_hold: 'En espera',
  ended: 'Finalizada',
};

// Eight digits starting with 2-8, with or without 506. Asterisk enforces the same
// rule. This copy only lets the agent see why a number can't be dialed.
const COSTA_RICA_NUMBER = /^(?:\+?506)?([2-8]\d{7})$/;
const MAX_DIAL_LENGTH = 20;

export function toDialNumber(input: string): string {
  return input.replace(/[^\d*#+]/g, '').slice(0, MAX_DIAL_LENGTH);
}

export function toCostaRicaNumber(input: string): string | null {
  return COSTA_RICA_NUMBER.exec(input.replace(/[\s()-]/g, ''))?.[1] ?? null;
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
