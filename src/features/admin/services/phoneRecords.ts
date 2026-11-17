import { getSupabaseClient } from '@/integrations/supabase/client';
import type { PhoneRecord } from '@/features/admin/models/missedCalls';
import { lastDigits } from '@/features/telephony/models/call';

interface PhoneRecordRow {
  linked_id: string;
  staff_id: string | null;
  direction: 'inbound' | 'outbound';
  number: string;
  disposition: string;
  talk_seconds: number;
  started_at: string;
}

/** The phone server's call legs (administrators read them all), newest first. */
export async function loadPhoneRecords(days: number, number?: string): Promise<PhoneRecord[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  let query = getSupabaseClient()
    .from('asterisk_calls')
    .select('linked_id,staff_id,direction,number,disposition,talk_seconds,started_at')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(5000);
  if (number) query = query.like('number', `%${lastDigits(number)}`);
  const { data, error } = await query;
  if (error) throw new Error('No se pudieron cargar las llamadas del servidor telefónico.');
  return ((data ?? []) as PhoneRecordRow[]).map((row) => ({
    linkedId: row.linked_id,
    staffId: row.staff_id,
    direction: row.direction,
    number: row.number,
    disposition: row.disposition,
    talkSeconds: row.talk_seconds,
    startedAt: row.started_at,
  }));
}
