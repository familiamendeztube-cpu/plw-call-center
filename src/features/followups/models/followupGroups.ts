import { getCostaRicaDayKey } from '@/app/dates';
import type { Followup } from '@/features/followups/models/followup';

export interface FollowupGroups {
  overdue: Followup[];
  today: Followup[];
  upcoming: Followup[];
  completed: Followup[];
}

function byDueDate(first: Followup, second: Followup): number {
  return new Date(first.dueAt).getTime() - new Date(second.dueAt).getTime();
}

export function groupFollowups(followups: Followup[], now: Date): FollowupGroups {
  const todayKey = getCostaRicaDayKey(now);
  const groups: FollowupGroups = { overdue: [], today: [], upcoming: [], completed: [] };

  followups.forEach((followup) => {
    if (followup.completed) {
      groups.completed.push(followup);
      return;
    }
    const due = new Date(followup.dueAt);
    if (due.getTime() < now.getTime()) {
      groups.overdue.push(followup);
      return;
    }
    if (getCostaRicaDayKey(due) === todayKey) {
      groups.today.push(followup);
      return;
    }
    groups.upcoming.push(followup);
  });

  groups.overdue.sort(byDueDate);
  groups.today.sort(byDueDate);
  groups.upcoming.sort(byDueDate);
  groups.completed.sort((first, second) => byDueDate(second, first));
  return groups;
}
