import { useCallback, useEffect, useState } from 'react';
import { IS_DEMO_MODE } from '@/app/appConfig';
import { useAsync } from '@/app/useAsync';
import { callStaffFunction } from '@/integrations/supabase/callStaffFunction';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { toSmsThread, type SmsRow, type SmsThread } from '@/features/sms/models/sms';

const REFRESH_MS = 15_000;
const COLUMNS = 'id, direction, body, status, is_stop, created_at';

// Row level security returns texts only to the customer's agent or an admin.
async function loadSms(prospectId: string): Promise<SmsThread> {
  // Demo customers are not in the database.
  if (IS_DEMO_MODE) return toSmsThread(prospectId, []);
  const { data, error } = await getSupabaseClient()
    .from('sms_messages')
    .select(COLUMNS)
    .eq('prospect_id', prospectId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw new Error('No se pudieron cargar los SMS.');
  return toSmsThread(prospectId, (data ?? []) as SmsRow[]);
}

/**
 * Whether the customer's newest text is theirs, for the dot on the SMS tab. Cheap enough for every
 * customer page; reloads whenever the customer's last activity changes.
 */
export function useSmsWaiting(prospectId: string, lastActivity: string | undefined, enabled: boolean) {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!enabled || IS_DEMO_MODE) return;
    let active = true;
    getSupabaseClient()
      .from('sms_messages')
      .select('direction')
      .eq('prospect_id', prospectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (active) setWaiting(data?.[0]?.direction === 'in');
      });
    return () => {
      active = false;
    };
  }, [prospectId, lastActivity, enabled]);
  return waiting;
}

/** The customer's texts, refreshed while the tab is open; send answers through the server. */
export function useSmsThread(prospectId: string) {
  const result = useAsync(() => loadSms(prospectId), [prospectId]);
  const { updateData } = result;

  // Updates in place, so the texts stay on screen while they reload.
  const refresh = useCallback(() => {
    loadSms(prospectId)
      .then((fresh) => updateData(() => fresh))
      .catch(() => undefined);
  }, [prospectId, updateData]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  const send = useCallback(
    async (body: string) => {
      try {
        // A new key per send; the server never sends one key twice.
        await callStaffFunction('us-sms', {
          action: 'reply',
          prospectId,
          body,
          idempotencyKey: crypto.randomUUID(),
        });
      } finally {
        // Also after an error: a timeout can hide a text that did go out.
        refresh();
      }
    },
    [prospectId, refresh]
  );

  const markRead = useCallback(() => {
    if (IS_DEMO_MODE) return;
    void getSupabaseClient().rpc('mark_sms_read', { p_prospect_id: prospectId });
  }, [prospectId]);

  return { ...result, send, markRead };
}
