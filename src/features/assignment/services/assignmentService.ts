import type {
  AssignmentBoard,
  NewInquiryInput,
  ReassignInput,
} from '@/features/assignment/models/assignment';

export interface AssignmentService {
  loadBoard(): Promise<AssignmentBoard>;
  createInquiry(input: NewInquiryInput, idempotencyKey: string): Promise<string>;
  reassignProspect(input: ReassignInput): Promise<void>;
}
