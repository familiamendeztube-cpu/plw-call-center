import type { FollowupService } from '@/features/followups/services/followupService';
import type { ScheduleFollowupInput } from '@/features/followups/models/followup';
import type { MaterialService } from '@/features/sales-materials/services/materialService';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { toFollowup, toMaterial } from '@/production/adapters/productionMappers';
import { readOptionalRow, readRows } from '@/production/adapters/productionRows';

const FOLLOWUP_COLUMNS = 'id, prospect_id, agent_id, kind, title, due_at, completed';
const MATERIAL_COLUMNS = 'id, title, description, kind, approval, url, updated_at';
const LOAD_ERROR = 'No se pudieron cargar los seguimientos.';
const SAVE_ERROR = 'No se pudo guardar el seguimiento.';
const MATERIAL_ERROR = 'No se pudieron cargar los materiales de venta.';

export function createProductionFollowupService(): FollowupService {
  const supabase = getSupabaseClient();

  async function fetchFollowup(followupId: string) {
    const { data, error } = await supabase
      .from('followups')
      .select(FOLLOWUP_COLUMNS)
      .eq('id', followupId)
      .maybeSingle();
    const row = error ? null : readOptionalRow(data);
    if (!row) throw new Error(SAVE_ERROR);
    return toFollowup(row);
  }

  return {
    async listFollowups(agentId) {
      let query = supabase
        .from('followups')
        .select(FOLLOWUP_COLUMNS)
        .order('due_at', { ascending: true });
      if (agentId !== null) {
        query = query.eq('agent_id', agentId);
      }
      const { data, error } = await query;
      if (error) throw new Error(LOAD_ERROR);
      return readRows(data).map(toFollowup);
    },

    async scheduleFollowup(input: ScheduleFollowupInput) {
      const { data: followupId, error } = await supabase.rpc('schedule_followup', {
        p_prospect_id: input.prospectId,
        p_kind: input.kind,
        p_title: input.title,
        p_due_at: input.dueAt,
      });
      if (error || typeof followupId !== 'string') throw new Error(SAVE_ERROR);
      return fetchFollowup(followupId);
    },

    async setCompleted(followupId, completed) {
      const { error } = await supabase.rpc('set_followup_completed', {
        p_followup_id: followupId,
        p_completed: completed,
      });
      if (error) throw new Error(SAVE_ERROR);
      return fetchFollowup(followupId);
    },
  };
}

export function createProductionMaterialService(): MaterialService {
  return {
    async listMaterials() {
      const { data, error } = await getSupabaseClient()
        .from('sales_materials')
        .select(MATERIAL_COLUMNS)
        .order('title', { ascending: true });
      if (error) throw new Error(MATERIAL_ERROR);
      return readRows(data).map(toMaterial);
    },
  };
}
