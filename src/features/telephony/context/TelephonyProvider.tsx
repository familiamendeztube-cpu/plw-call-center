import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/features/auth/context/useAuth';
import type { CallSnapshot, RecentCall } from '@/features/telephony/models/call';
import {
  TelephonyContext,
  type TelephonyContextValue,
} from '@/features/telephony/context/telephonyContext';
import type {
  TelephonyConnector,
  TelephonyConnectorStatus,
} from '@/integrations/telephony/telephonyContract';

const MAX_DIAL_LENGTH = 20;

interface TelephonyProviderProps {
  connector: TelephonyConnector;
  children: ReactNode;
}

function durationSeconds(startedAt: string | null): number {
  if (!startedAt) {
    return 0;
  }
  return Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000));
}

export function TelephonyProvider({ connector, children }: TelephonyProviderProps) {
  const { session } = useAuth();
  const agentId = session?.role === 'agent' ? session.agentId : null;
  const [connectorStatus, setConnectorStatus] = useState<TelephonyConnectorStatus>(
    connector.status
  );
  const [call, setCall] = useState<CallSnapshot | null>(null);
  const [dialNumber, setDialNumber] = useState('');
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [commandError, setCommandError] = useState<string | null>(null);

  useEffect(() => {
    return connector.subscribe((event) => {
      if (event.type === 'status') {
        setConnectorStatus(event.status);
        if (event.message) setCommandError(event.message);
        else if (event.status === 'registered') setCommandError(null);
        return;
      }
      setCall(event.call);
      if (event.message) setCommandError(event.message);
      if (event.call?.state === 'ended') {
        const finished = event.call;
        setRecentCalls((current) => [
          {
            id: finished.id,
            remoteNumber: finished.remoteNumber,
            direction: finished.direction,
            endedAt: new Date().toISOString(),
            durationSeconds: durationSeconds(finished.startedAt),
          },
          ...current.slice(0, 19),
        ]);
      }
    });
  }, [connector]);

  useEffect(() => {
    if (!agentId) return undefined;
    void connector.start();
    return () => connector.stop();
  }, [connector, agentId]);

  const runCommand = useCallback(
    async (command: () => Promise<{ ok: boolean; message: string }>) => {
      const result = await command();
      setCommandError(result.ok ? null : result.message);
    },
    []
  );

  const appendDigit = useCallback((digit: string) => {
    setDialNumber((current) => (current.length < MAX_DIAL_LENGTH ? `${current}${digit}` : current));
  }, []);

  const deleteDigit = useCallback(() => setDialNumber((current) => current.slice(0, -1)), []);

  const clearDialNumber = useCallback(() => setDialNumber(''), []);

  const placeCall = useCallback(
    () => runCommand(() => connector.dial(dialNumber)),
    [connector, dialNumber, runCommand]
  );

  const answerCall = useCallback(
    () => runCommand(() => connector.answer()),
    [connector, runCommand]
  );

  const hangUp = useCallback(() => runCommand(() => connector.hangup()), [connector, runCommand]);

  const toggleMute = useCallback(
    () => runCommand(() => connector.setMuted(!call?.muted)),
    [connector, call, runCommand]
  );

  const toggleHold = useCallback(
    () => runCommand(() => connector.setOnHold(call?.state !== 'on_hold')),
    [connector, call, runCommand]
  );

  const transferCall = useCallback(
    () => runCommand(() => connector.transfer(dialNumber)),
    [connector, dialNumber, runCommand]
  );

  const value = useMemo<TelephonyContextValue>(
    () => ({
      connectorStatus,
      call,
      dialNumber,
      recentCalls,
      commandError,
      appendDigit,
      deleteDigit,
      clearDialNumber,
      placeCall,
      answerCall,
      hangUp,
      toggleMute,
      toggleHold,
      transferCall,
    }),
    [
      connectorStatus,
      call,
      dialNumber,
      recentCalls,
      commandError,
      appendDigit,
      deleteDigit,
      clearDialNumber,
      placeCall,
      answerCall,
      hangUp,
      toggleMute,
      toggleHold,
      transferCall,
    ]
  );

  return <TelephonyContext.Provider value={value}>{children}</TelephonyContext.Provider>;
}
