import type { AssignmentService } from '@/features/assignment/services/assignmentService';
import type { NewInquiryInput } from '@/features/assignment/models/assignment';
import { getSupabaseClient } from '@/integrations/supabase/client';
import {
  toAssignmentHistoryEntry,
  toOverdueEntry,
  toWaitingEntry,
} from '@/production/adapters/productionMappers';
import { readRows } from '@/production/adapters/productionRows';

const BOARD_ERROR = 'No se pudo cargar el tablero de asignaciones.';
const INQUIRY_ERROR = 'No se pudo registrar la consulta.';
const REASSIGN_ERROR = 'No se pudo reasignar el prospecto.';
const HISTORY_LIMIT = 100;

export function createProductionAssignmentService(): AssignmentService {
  const supabase = getSupabaseClient();

  return {
    async loadBoard() {
      const [waitingResult, overdueResult, historyResult] = await Promise.all([
        supabase
          .from('assignment_queue')
          .select('prospect_id, queued_at')
          .eq('status', 'waiting')
          .order('queued_at', { ascending: true }),
        supabase.rpc('list_overdue_conversations'),
        supabase
          .from('assignment_history')
          .select('id, prospect_id, from_owner_id, to_owner_id, mechanism, reason, created_at')
          .order('created_at', { ascending: false })
          .limit(HISTORY_LIMIT),
      ]);
      if (waitingResult.error || overdueResult.error || historyResult.error) {
        throw new Error(BOARD_ERROR);
      }
      return {
        waiting: readRows(waitingResult.data).map(toWaitingEntry),
        overdue: readRows(overdueResult.data).map(toOverdueEntry),
        history: readRows(historyResult.data).map(toAssignmentHistoryEntry),
      };
    },

    async createInquiry(input: NewInquiryInput, idempotencyKey: string) {
      const { data, error } = await supabase.rpc('create_inquiry', {
        p_business_name: input.businessName,
        p_contact_name: input.contactName,
        p_email: input.email,
        p_phone: input.phone,
        p_business_category: input.businessCategory,
        p_service_interest: input.serviceInterest,
        p_source: input.source,
        p_notes: input.notes,
        p_is_test: input.isTest,
        p_idempotency_key: idempotencyKey,
      });
      if (error || typeof data !== 'string') throw new Error(INQUIRY_ERROR);
      return data;
    },

    async reassignProspect({ prospectId, toAgentId, reason }) {
      const { error } = await supabase.rpc('reassign_prospect', {
        p_prospect_id: prospectId,
        p_to_staff_id: toAgentId,
        p_reason: reason.trim(),
      });
      if (error) throw new Error(REASSIGN_ERROR);
    },
  };
}
