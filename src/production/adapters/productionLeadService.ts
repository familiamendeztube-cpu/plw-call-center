import type { LeadService } from '@/features/leads/services/leadService';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { readOptionalRow, readRows } from '@/production/adapters/productionRows';
import { toNote, toProspect } from '@/production/adapters/productionMappers';

const PROSPECT_COLUMNS =
  'id, business_name, contact_name, email, phone, business_category, service_interest, source, owner_id, stage, payment_status, next_action, next_follow_up_at, created_at';
const NOTE_COLUMNS = 'id, prospect_id, author_id, body, created_at';
const LOAD_ERROR = 'No se pudieron cargar los prospectos.';
const SAVE_ERROR = 'No se pudo guardar el cambio.';
const NOTE_ERROR = 'No se pudo guardar la nota.';
const MISSING_PROSPECT = 'El prospecto ya no está disponible.';

export function createProductionLeadService(): LeadService {
  const supabase = getSupabaseClient();

  async function fetchProspect(prospectId: string) {
    const { data, error } = await supabase
      .from('prospects')
      .select(PROSPECT_COLUMNS)
      .eq('id', prospectId)
      .maybeSingle();
    if (error) throw new Error(LOAD_ERROR);
    const row = readOptionalRow(data);
    return row ? toProspect(row) : null;
  }

  return {
    async listProspects() {
      const { data, error } = await supabase
        .from('prospects')
        .select(PROSPECT_COLUMNS)
        .order('created_at', { ascending: false });
      if (error) throw new Error(LOAD_ERROR);
      return readRows(data).map(toProspect);
    },

    getProspect: fetchProspect,

    async updateStage(prospectId, stage) {
      const { error } = await supabase.rpc('set_prospect_stage', {
        p_prospect_id: prospectId,
        p_stage: stage,
      });
      if (error) throw new Error(SAVE_ERROR);
      const prospect = await fetchProspect(prospectId);
      if (!prospect) throw new Error(MISSING_PROSPECT);
      return prospect;
    },

    async listNotes(prospectId) {
      const { data, error } = await supabase
        .from('private_notes')
        .select(NOTE_COLUMNS)
        .eq('prospect_id', prospectId)
        .order('created_at', { ascending: true });
      if (error) throw new Error(LOAD_ERROR);
      return readRows(data).map(toNote);
    },

    async addNote({ prospectId, body }) {
      const { data: noteId, error } = await supabase.rpc('add_private_note', {
        p_prospect_id: prospectId,
        p_body: body,
      });
      if (error || typeof noteId !== 'string') throw new Error(NOTE_ERROR);
      const { data, error: readError } = await supabase
        .from('private_notes')
        .select(NOTE_COLUMNS)
        .eq('id', noteId)
        .maybeSingle();
      const row = readError ? null : readOptionalRow(data);
      if (!row) throw new Error(NOTE_ERROR);
      return toNote(row);
    },
  };
}
