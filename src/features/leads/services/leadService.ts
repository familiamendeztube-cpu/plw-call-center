import type { AgentId } from '@/features/auth/models/agent';
import type { PrivateNote } from '@/features/leads/models/note';
import type { Prospect, SalesStage } from '@/features/leads/models/prospect';

export interface NewNoteInput {
  prospectId: string;
  agentId: AgentId;
  body: string;
}

export interface LeadService {
  listProspects(): Promise<Prospect[]>;
  getProspect(prospectId: string): Promise<Prospect | null>;
  updateStage(prospectId: string, stage: SalesStage): Promise<Prospect>;
  listNotes(prospectId: string): Promise<PrivateNote[]>;
  addNote(input: NewNoteInput): Promise<PrivateNote>;
}
