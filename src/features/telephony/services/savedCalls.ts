import { getSupabaseClient } from '@/integrations/supabase/client';
import type { CallDirection, RecentCall } from '@/features/telephony/models/call';

interface SavedCallRow {
  unique_id: string;
  direction: CallDirection;
  number: string;
  talk_seconds: number;
  ended_at: string;
}

/** The agent's own calls as the phone server recorded them (asterisk_calls), newest first. */
export async function loadSavedCalls(staffId: string, signal: AbortSignal): Promise<RecentCall[]> {
  const { data, error } = await getSupabaseClient()
    .from('asterisk_calls')
    .select('unique_id,direction,number,talk_seconds,ended_at')
    .eq('staff_id', staffId)
    .order('ended_at', { ascending: false })
    .limit(20)
    .abortSignal(signal);
  if (error) throw error;
  return ((data ?? []) as SavedCallRow[]).map((row) => ({
    id: row.unique_id,
    remoteNumber: row.number,
    direction: row.direction,
    endedAt: row.ended_at,
    durationSeconds: row.talk_seconds,
  }));
}
