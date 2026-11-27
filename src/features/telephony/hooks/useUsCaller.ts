import { useEffect, useState } from 'react';
import { IS_DEMO_MODE } from '@/app/appConfig';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { useOptionalAgentProspects } from '@/features/leads/context/agentProspectsContext';
import { toUsNumber, type CallSnapshot } from '@/features/telephony/models/call';

/** A US business Anna called, as public.us_caller returns it. */
export interface UsCaller {
  business_name: string;
  contact_name: string | null;
  business_type: string | null;
  /** The business's own time zone, when known. */
  timezone: string | null;
  /** The agent's customer for this business, once the call is answered. */
  prospect_id: string | null;
  /** Anna's last call to the business, if she called it. */
  anna_called_at: string | null;
  outcome: string | null;
  summary: string | null;
}

/**
 * The business on an inbound US call when it is one Anna called: looked up while it rings, and
 * made the answering agent's customer once answered, so notes and the SMS tab are there.
 */
export function useUsCaller(call: CallSnapshot | null): UsCaller | null {
  const live = call?.direction === 'inbound' && ['ringing', 'active', 'on_hold'].includes(call.state) ? call : null;
  const phone = live ? toUsNumber(live.remoteNumber) : null;
  const callId = phone && live ? live.id : null;
  const answered = live?.state !== 'ringing';
  const reload = useOptionalAgentProspects()?.reload;
  const [found, setFound] = useState<{ callId: string; caller: UsCaller | null } | null>(null);

  useEffect(() => {
    if (!callId || !phone || IS_DEMO_MODE) return;
    let current = true;
    void getSupabaseClient()
      .rpc('us_caller', { p_phone: phone, p_answered: answered })
      .then(({ data, error }) => {
        // A failed lookup keeps what was found while it rang; the wrap-up can still add the customer.
        if (!current || error) return;
        const caller = (data as UsCaller | null) ?? null;
        setFound({ callId, caller });
        if (caller?.prospect_id) reload?.();
      });
    return () => {
      current = false;
    };
  }, [callId, phone, answered, reload]);

  return found?.callId === callId ? found.caller : null;
}
