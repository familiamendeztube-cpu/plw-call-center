import type {
  AssignmentHistoryEntry,
  NewInquiryInput,
  OverdueEntry,
  ReassignInput,
  WaitingEntry,
} from '@/features/assignment/models/assignment';
import type { AssignmentService } from '@/features/assignment/services/assignmentService';
import type { DemoState } from '@/demo/demoState';
import { createDemoId, simulateLatency } from '@/demo/demoIds';
import type { Prospect } from '@/features/leads/models/prospect';

const DEMO_OVERDUE_AFTER_MS = 2 * 60 * 60 * 1000;

export function createDemoAssignmentService(state: DemoState): AssignmentService {
  return {
    async loadBoard() {
      await simulateLatency(120);
      const now = Date.now();
      const waiting: WaitingEntry[] = state.prospects
        .filter((prospect) => prospect.assignedAgentId === null)
        .map((prospect) => ({ prospectId: prospect.id, queuedAt: prospect.createdAt }));
      const overdue: OverdueEntry[] = state.conversations
        .filter(
          (conversation) =>
            conversation.status === 'waiting_agent' &&
            now - new Date(conversation.lastMessageAt).getTime() > DEMO_OVERDUE_AFTER_MS
        )
        .map((conversation) => ({
          conversationId: conversation.id,
          prospectId: conversation.prospectId,
          ownerId:
            state.prospects.find((prospect) => prospect.id === conversation.prospectId)
              ?.assignedAgentId ?? null,
          lastMessageAt: conversation.lastMessageAt,
        }));
      return {
        waiting,
        overdue,
        history: state.assignmentHistory.map((entry) => ({ ...entry })),
      };
    },

    async createInquiry(input: NewInquiryInput) {
      await simulateLatency(180);
      const prospect: Prospect = {
        id: createDemoId('prospect'),
        businessName: input.businessName,
        contactName: input.contactName,
        email: input.email,
        phone: input.phone,
        businessCategory: input.businessCategory,
        serviceInterest: input.serviceInterest,
        assignedAgentId: null,
        stage: 'new',
        paymentStatus: 'not_recorded',
        nextAction: '',
        nextFollowUpAt: null,
        createdAt: new Date().toISOString(),
      };
      state.prospects = [prospect, ...state.prospects];
      return prospect.id;
    },

    async reassignProspect(input: ReassignInput) {
      await simulateLatency(180);
      const prospect = state.prospects.find((item) => item.id === input.prospectId);
      if (!prospect) {
        throw new Error('No se encontró el prospecto.');
      }
      const entry: AssignmentHistoryEntry = {
        id: createDemoId('assignment'),
        prospectId: prospect.id,
        fromOwnerId: prospect.assignedAgentId,
        toOwnerId: input.toAgentId,
        mechanism: 'manual',
        reason: input.reason.trim(),
        createdAt: new Date().toISOString(),
      };
      state.prospects = state.prospects.map((item) =>
        item.id === prospect.id ? { ...item, assignedAgentId: input.toAgentId } : item
      );
      state.conversations = state.conversations.map((conversation) =>
        conversation.prospectId === prospect.id
          ? { ...conversation, assignedAgentId: input.toAgentId }
          : conversation
      );
      state.assignmentHistory = [entry, ...state.assignmentHistory];
    },
  };
}
