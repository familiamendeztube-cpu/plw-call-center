import type { Followup, ScheduleFollowupInput } from '@/features/followups/models/followup';

export interface FollowupService {
  listFollowups(agentId: string | null): Promise<Followup[]>;
  scheduleFollowup(input: ScheduleFollowupInput): Promise<Followup>;
  setCompleted(followupId: string, completed: boolean): Promise<Followup>;
  /** A new time; a done follow-up becomes pending again. */
  reschedule(followupId: string, dueAt: string): Promise<Followup>;
}
