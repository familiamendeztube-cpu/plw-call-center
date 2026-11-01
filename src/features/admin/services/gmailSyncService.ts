import { parseGmailSyncStatus, type GmailSyncStatus } from '@/features/admin/models/gmailSync';
import { getSupabaseClient } from '@/integrations/supabase/client';

const INVALID_RESPONSE = 'La respuesta del servidor no es válida. Intenta de nuevo.';
const GENERIC_ERROR = 'No se pudo completar la acción. Intenta de nuevo.';

function toError(error: { message?: string } | null): Error {
  return new Error(error?.message?.trim() || GENERIC_ERROR);
}

export async function fetchGmailSyncStatus(): Promise<GmailSyncStatus> {
  const { data, error } = await getSupabaseClient().rpc('admin_gmail_sync_status');
  if (error) throw toError(error);
  const status = parseGmailSyncStatus(data);
  if (!status) throw new Error(INVALID_RESPONSE);
  return status;
}

export interface GmailSyncChange {
  running: boolean;
  importFrom: string | null;
}

export async function changeGmailSync(change: GmailSyncChange): Promise<GmailSyncStatus> {
  const { data, error } = await getSupabaseClient().rpc('admin_set_gmail_sync', {
    p_running: change.running,
    p_import_from: change.importFrom,
  });
  if (error) throw toError(error);
  const status = parseGmailSyncStatus(data);
  if (!status) throw new Error(INVALID_RESPONSE);
  return status;
}
