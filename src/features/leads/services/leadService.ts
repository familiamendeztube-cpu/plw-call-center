import type { AgentId } from '@/features/auth/models/agent';
import type { PrivateNote } from '@/features/leads/models/note';
import type { PaymentStatus, Prospect, SalesStage } from '@/features/leads/models/prospect';

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

/** A customer an agent adds themselves: a walk-in, a referral, a caller who isn't on file. */
export type NewCustomerInput = ProspectDetails & Pick<Prospect, 'email'>;

export interface LeadService {
  listProspects(): Promise<Prospect[]>;
  getProspect(prospectId: string): Promise<Prospect | null>;
  updateStage(prospectId: string, stage: SalesStage): Promise<Prospect>;
  updateDetails(prospectId: string, details: ProspectDetails): Promise<Prospect>;
  /** The agent's own customer; the same number or email returns the agent's existing one. */
  createProspect(input: NewCustomerInput, agentId: AgentId): Promise<Prospect>;
  /** Administrators only. */
  setPaymentStatus(prospectId: string, status: PaymentStatus): Promise<Prospect>;
  listNotes(prospectId: string): Promise<PrivateNote[]>;
  addNote(input: NewNoteInput): Promise<PrivateNote>;
}
