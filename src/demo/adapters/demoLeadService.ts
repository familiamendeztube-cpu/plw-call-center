import type { LeadService, NewNoteInput } from '@/features/leads/services/leadService';
import type { SalesStage } from '@/features/leads/models/prospect';
import { SALES_STAGE_LABELS } from '@/features/leads/models/prospect';
import type { DemoState } from '@/demo/demoState';
import { createDemoId, simulateLatency } from '@/demo/demoIds';

const MAX_NOTE_LENGTH = 2000;

export function createDemoLeadService(state: DemoState): LeadService {
  return {
    async listProspects() {
      await simulateLatency(120);
      return state.prospects.map((prospect) => ({ ...prospect }));
    },
    async getProspect(prospectId) {
      await simulateLatency(100);
      const prospect = state.prospects.find((item) => item.id === prospectId);
      return prospect ? { ...prospect } : null;
    },
    async updateStage(prospectId, stage: SalesStage) {
      await simulateLatency(150);
      const current = state.prospects.find((item) => item.id === prospectId);
      if (!current) {
        throw new Error('No se encontró el prospecto.');
      }
      const updated = { ...current, stage };
      state.prospects = state.prospects.map((item) => (item.id === prospectId ? updated : item));
      if (current.assignedAgentId) {
        state.activity = [
          {
            id: createDemoId('activity'),
            agentId: current.assignedAgentId,
            kind: 'stage_change',
            summary: `Cambió ${current.businessName} a ${SALES_STAGE_LABELS[stage]}`,
            occurredAt: new Date().toISOString(),
          },
          ...state.activity,
        ];
      }
      return updated;
    },
    async listNotes(prospectId) {
      await simulateLatency(100);
      return state.notes
        .filter((note) => note.prospectId === prospectId)
        .sort((first, second) => first.createdAt.localeCompare(second.createdAt));
    },
    async addNote({ prospectId, agentId, body }: NewNoteInput) {
      await simulateLatency(150);
      const trimmed = body.trim();
      if (trimmed.length === 0) {
        throw new Error('La nota no puede estar vacía.');
      }
      if (trimmed.length > MAX_NOTE_LENGTH) {
        throw new Error(`La nota no puede superar ${MAX_NOTE_LENGTH} caracteres.`);
      }
      const note = {
        id: createDemoId('note'),
        prospectId,
        agentId,
        body: trimmed,
        createdAt: new Date().toISOString(),
      };
      state.notes = [...state.notes, note];
      const prospect = state.prospects.find((item) => item.id === prospectId);
      if (prospect) {
        state.activity = [
          {
            id: createDemoId('activity'),
            agentId,
            kind: 'note',
            summary: `Agregó una nota privada en ${prospect.businessName}`,
            occurredAt: note.createdAt,
          },
          ...state.activity,
        ];
      }
      return note;
    },
  };
}
