import { useEffect, useState } from 'react';
import type { CallSnapshot } from '@/features/telephony/models/call';
import { loadIncomingDentalCall } from '../services/dentalDialer';
import { isPollableDentalCall, type IncomingDentalLookup } from '../models/incomingDentalCall';

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 20;

interface LookupState {
  key: string;
  lookup: IncomingDentalLookup;
}

export function useIncomingDentalCall(
  call: CallSnapshot | null,
  agentId: string | null | undefined
): IncomingDentalLookup | null {
  const callId = call?.dentalCallId ?? null;
  const pollable = isPollableDentalCall(call);
  const key = `${callId}|${agentId}`;
  const [state, setState] = useState<LookupState | null>(null);

  useEffect(() => {
    if (!callId || agentId == null || !pollable) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    const load = () => {
      polls += 1;
      loadIncomingDentalCall(callId, controller.signal)
        .then(({ call: row, lead }) => {
          if (controller.signal.aborted) return;
          setState({ key, lookup: { status: 'ready', call: row, lead } });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setState((prev) =>
            prev?.key === key && prev.lookup.status === 'ready'
              ? prev
              : { key, lookup: { status: 'unknown' } }
          );
        })
        .finally(() => {
          if (!controller.signal.aborted && polls < MAX_POLLS) {
            timer = setTimeout(load, POLL_INTERVAL_MS);
          }
        });
    };

    setState({ key, lookup: { status: 'loading' } });
    load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, callId, agentId, pollable]);

  if (!callId || !pollable) return null;
  return state?.key === key ? state.lookup : { status: 'loading' };
}
