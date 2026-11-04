import { createContext, useContext } from 'react';
import type { CallSnapshot, RecentCall } from '@/features/telephony/models/call';
import type { TelephonyConnectorStatus } from '@/integrations/telephony/telephonyContract';

export interface TelephonyContextValue {
  connectorStatus: TelephonyConnectorStatus;
  call: CallSnapshot | null;
  dialNumber: string;
  recentCalls: RecentCall[];
  commandError: string | null;
  changeDialNumber: (value: string) => void;
  clearDialNumber: () => void;
  placeCall: () => Promise<void>;
  answerCall: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleHold: () => Promise<void>;
  transferCall: () => Promise<void>;
}

export const TelephonyContext = createContext<TelephonyContextValue | null>(null);

export function useTelephony(): TelephonyContextValue {
  const value = useContext(TelephonyContext);
  if (!value) {
    throw new Error('useTelephony debe usarse dentro de TelephonyProvider.');
  }
  return value;
}
