import type { AgentId } from '@/features/auth/models/agent';
import type { PrivateNote } from '@/features/leads/models/note';
import type { Prospect, SalesStage } from '@/features/leads/models/prospect';

export interface NewNoteInput {
  prospectId: string;
  agentId: AgentId;
  body: string;
}

/** What an agent can correct on a customer. Email stays as it arrived: replies thread by it. */
export type ProspectDetails = Pick<
  Prospect,
  'businessName' | 'contactName' | 'phone' | 'businessCategory' | 'serviceInterest'
>;

export interface LeadService {
  listProspects(): Promise<Prospect[]>;
  getProspect(prospectId: string): Promise<Prospect | null>;
  updateStage(prospectId: string, stage: SalesStage): Promise<Prospect>;
  updateDetails(prospectId: string, details: ProspectDetails): Promise<Prospect>;
  listNotes(prospectId: string): Promise<PrivateNote[]>;
  addNote(input: NewNoteInput): Promise<PrivateNote>;
}
