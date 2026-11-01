import type { AgentDirectory } from '@/features/auth/services/agentDirectory';
import type { AuthService } from '@/features/auth/services/authService';
import type { AssignmentService } from '@/features/assignment/services/assignmentService';
import type { FollowupService } from '@/features/followups/services/followupService';
import type { InboxService } from '@/features/inbox/services/inboxService';
import type { LeadService } from '@/features/leads/services/leadService';
import type { PresenceService } from '@/features/presence/services/presenceService';
import type { MaterialService } from '@/features/sales-materials/services/materialService';
import type { EmailConnector } from '@/integrations/email/emailContract';
import type { TelephonyConnector } from '@/integrations/telephony/telephonyContract';

export interface AppServices {
  auth: AuthService;
  agents: AgentDirectory;
  presence: PresenceService;
  inbox: InboxService;
  leads: LeadService;
  followups: FollowupService;
  materials: MaterialService;
  assignments: AssignmentService;
  email: EmailConnector;
  telephony: TelephonyConnector;
}
