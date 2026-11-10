import { useEffect, useState } from 'react';
import type { CallSnapshot } from '@/features/telephony/models/call';
import { loadIncomingDentalCall } from '../services/dentalDialer';
import type { IncomingDentalLookup } from '../models/incomingDentalCall';

interface LookupState {
  callId: string;
  lookup: IncomingDentalLookup;
}

export function useIncomingDentalCall(
  call: CallSnapshot | null,
  agentId: string | null | undefined
): IncomingDentalLookup | null {
  const callId = call?.dentalCallId ?? null;
  const [state, setState] = useState<LookupState | null>(null);

  useEffect(() => {
    if (!callId || agentId == null) return;
    const controller = new AbortController();
    setState({ callId, lookup: { status: 'loading' } });
    loadIncomingDentalCall(callId, controller.signal)
      .then(({ call: row, lead }) => {
        if (!controller.signal.aborted)
          setState({ callId, lookup: { status: 'ready', call: row, lead } });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ callId, lookup: { status: 'unknown' } });
      });
    return () => controller.abort();
  }, [callId, agentId]);

  if (!callId) return null;
  return state?.callId === callId ? state.lookup : { status: 'loading' };
}
