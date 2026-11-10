import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/features/auth/context/useAuth';
import {
  mergeRecentCalls,
  toDialNumber,
  type CallSnapshot,
  type RecentCall,
} from '@/features/telephony/models/call';
import { loadSavedCalls } from '@/features/telephony/services/savedCalls';
import {
  TelephonyContext,
  type TelephonyContextValue,
} from '@/features/telephony/context/telephonyContext';
import type {
  TelephonyConnector,
  TelephonyConnectorStatus,
} from '@/integrations/telephony/telephonyContract';

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
  const production = session?.source === 'production';
  const [connectorStatus, setConnectorStatus] = useState<TelephonyConnectorStatus>(
    connector.status
  );
  const [call, setCall] = useState<CallSnapshot | null>(null);
  const [dialNumber, setDialNumber] = useState('');
  // Calls that ended in this tab; savedCalls are the server's records and survive a refresh.
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [savedCalls, setSavedCalls] = useState<RecentCall[]>([]);
  const [savedVersion, setSavedVersion] = useState(0);
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
        // The phone server saves the call within seconds; fetch it so it replaces this one.
        window.setTimeout(() => setSavedVersion((v) => v + 1), 15_000);
      }
    });
  }, [connector]);

  useEffect(() => {
    if (!agentId || !production) return undefined;
    const controller = new AbortController();
    const load = () =>
      loadSavedCalls(agentId, controller.signal)
        .then((calls) => {
          if (!controller.signal.aborted) setSavedCalls(calls);
        })
        .catch(() => {
          /* Keep what is shown; the next refresh retries. */
        });
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [agentId, production, savedVersion]);

  useEffect(() => {
    if (!agentId) return undefined;
    void connector.start();
    return () => connector.stop();
  }, [connector, agentId]);

  // This provider outlives logout, so the next person on this computer would inherit the phone.
  useEffect(
    () => () => {
      setCall(null);
      setDialNumber('');
      setRecentCalls([]);
      setSavedCalls([]);
      setCommandError(null);
    },
    [agentId]
  );

  const shownCalls = useMemo(
    () => mergeRecentCalls(recentCalls, savedCalls),
    [recentCalls, savedCalls]
  );

  const runCommand = useCallback(
    async (command: () => Promise<{ ok: boolean; message: string }>) => {
      const result = await command();
      setCommandError(result.ok ? null : result.message);
    },
    []
  );

  const changeDialNumber = useCallback((value: string) => setDialNumber(toDialNumber(value)), []);

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

  const sendDtmf = useCallback(
    (digit: string) => runCommand(() => connector.sendDtmf(digit)),
    [connector, runCommand]
  );

  const value = useMemo<TelephonyContextValue>(
    () => ({
      connectorStatus,
      call,
      dialNumber,
      recentCalls: shownCalls,
      commandError,
      changeDialNumber,
      clearDialNumber,
      placeCall,
      answerCall,
      hangUp,
      toggleMute,
      toggleHold,
      transferCall,
      sendDtmf,
    }),
    [
      connectorStatus,
      call,
      dialNumber,
      shownCalls,
      commandError,
      changeDialNumber,
      clearDialNumber,
      placeCall,
      answerCall,
      hangUp,
      toggleMute,
      toggleHold,
      transferCall,
      sendDtmf,
    ]
  );

  return <TelephonyContext.Provider value={value}>{children}</TelephonyContext.Provider>;
}
