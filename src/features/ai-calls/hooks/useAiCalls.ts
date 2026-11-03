import { useCallback, useEffect } from 'react';
import { useAsync } from '@/app/useAsync';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { AI_CALL_COLUMNS, type AiCall, type AiCallStatus } from '@/features/ai-calls/models/aiCall';

const REFRESH_MS = 30_000;

// Row level security limits agents to their own customers' requests.
async function loadAiCalls(prospectId?: string, status?: AiCallStatus): Promise<AiCall[]> {
  let query = getSupabaseClient()
    .from('ai_call_requests')
    .select(AI_CALL_COLUMNS)
    .order('call_started_at', { ascending: false })
    .limit(500);
  if (prospectId) query = query.eq('prospect_id', prospectId);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error('No se pudieron cargar las llamadas de la IA.');
  return data as unknown as AiCall[];
}

export async function setAiCallStatus(requestId: string, status: AiCallStatus): Promise<void> {
  const { error } = await getSupabaseClient().rpc('set_ai_call_status', {
    p_request_id: requestId,
    p_status: status,
  });
  if (error) throw new Error('No se pudo cambiar el estado.');
}

export async function countRecentWebhookFailures(): Promise<number> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { count, error } = await getSupabaseClient()
    .from('ai_webhook_failures')
    .select('id', { count: 'exact', head: true })
    .gte('received_at', since);
  if (error || count === null) throw new Error('No se pudieron revisar los errores del webhook.');
  return count;
}

export function useAiCalls({ prospectId, status }: { prospectId?: string; status?: AiCallStatus } = {}) {
  const result = useAsync(() => loadAiCalls(prospectId, status), [prospectId, status]);
  const { updateData } = result;

  // Updates the list in place, so cards stay on screen while it reloads.
  const refresh = useCallback(() => {
    loadAiCalls(prospectId, status)
      .then((data) => updateData(() => data))
      .catch(() => undefined);
  }, [prospectId, status, updateData]);

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

  return { ...result, refresh };
}
