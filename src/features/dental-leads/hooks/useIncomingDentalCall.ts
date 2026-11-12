import { useEffect, useState } from 'react';
import type { CallSnapshot } from '@/features/telephony/models/call';
import { loadIncomingDentalCall } from '../services/dentalDialer';
import { dentalMatch, type IncomingDentalLookup } from '../models/incomingDentalCall';

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
  const match = dentalMatch(call);
  const id = match?.id ?? null;
  const phone = match?.phone ?? null;
  const key = `${id}|${phone}|${agentId}`;
  const [state, setState] = useState<LookupState | null>(null);

  useEffect(() => {
    if ((!id && !phone) || agentId == null) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    const load = () => {
      polls += 1;
      loadIncomingDentalCall({ id, phone }, controller.signal)
        .then((found) => {
          if (controller.signal.aborted) return;
          if (!found) {
            // The number matches no recent dental call: an ordinary call, stop looking.
            polls = MAX_POLLS;
            setState({ key, lookup: { status: 'none' } });
            return;
          }
          setState({ key, lookup: { status: 'ready', call: found.call, lead: found.lead } });
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
  }, [key, id, phone, agentId]);

  if (!id && !phone) return null;
  return state?.key === key ? state.lookup : { status: 'loading' };
}
