import { useMemo } from 'react';
import { StatusMessage } from '@/components/ui/StatusMessage';
import type { Followup } from '@/features/followups/models/followup';
import { groupFollowups } from '@/features/followups/models/followupGroups';
import { FollowupItem } from '@/features/followups/components/FollowupItem';

interface FollowupBoardProps {
  followups: Followup[];
  prospectNames: Record<string, string>;
  ownerNames?: Record<string, string>;
  onToggle?: (followup: Followup) => void;
  now: Date;
}

interface GroupSectionProps {
  title: string;
  items: Followup[];
  emptyText: string;
  prospectNames: Record<string, string>;
  ownerNames?: Record<string, string>;
  onToggle?: (followup: Followup) => void;
  overdue?: boolean;
}

function GroupSection({
  title,
  items,
  emptyText,
  prospectNames,
  ownerNames,
  onToggle,
  overdue = false,
}: GroupSectionProps) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-plw-ink">
        {title}
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
          {items.length}
        </span>
      </h2>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-4 text-center text-sm text-neutral-500">
          {emptyText}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((followup) => (
            <FollowupItem
              key={followup.id}
              followup={followup}
              prospectName={prospectNames[followup.prospectId] ?? 'Prospecto'}
              ownerName={ownerNames?.[followup.agentId]}
              overdue={overdue}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function FollowupBoard({
  followups,
  prospectNames,
  ownerNames,
  onToggle,
  now,
}: FollowupBoardProps) {
  const groups = useMemo(() => groupFollowups(followups, now), [followups, now]);

  if (followups.length === 0) {
    return <StatusMessage tone="empty" title="No hay seguimientos programados." />;
  }

  return (
    <div className="flex flex-col gap-8">
      <GroupSection
        title="Vencidos"
        items={groups.overdue}
        emptyText="No tienes seguimientos vencidos."
        prospectNames={prospectNames}
        ownerNames={ownerNames}
        onToggle={onToggle}
        overdue
      />
      <GroupSection
        title="Hoy"
        items={groups.today}
        emptyText="No hay seguimientos para hoy."
        prospectNames={prospectNames}
        ownerNames={ownerNames}
        onToggle={onToggle}
      />
      <GroupSection
        title="Próximos"
        items={groups.upcoming}
        emptyText="No hay seguimientos próximos."
        prospectNames={prospectNames}
        ownerNames={ownerNames}
        onToggle={onToggle}
      />
      <GroupSection
        title="Completados"
        items={groups.completed}
        emptyText="Aún no hay seguimientos completados."
        prospectNames={prospectNames}
        ownerNames={ownerNames}
        onToggle={onToggle}
      />
    </div>
  );
}
