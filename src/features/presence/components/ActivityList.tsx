import { formatDateTime } from '@/app/dates';
import { Badge } from '@/components/ui/Badge';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { ACTIVITY_KIND_LABELS, type ActivityEvent } from '@/features/presence/models/activity';

interface ActivityListProps {
  events: ActivityEvent[];
  agentNames?: Record<string, string>;
  emptyTitle: string;
}

export function ActivityList({ events, agentNames, emptyTitle }: ActivityListProps) {
  if (events.length === 0) {
    return <StatusMessage tone="empty" title={emptyTitle} />;
  }

  return (
    <ol className="flex flex-col divide-y divide-neutral-200 rounded-xl border border-neutral-200/80 bg-white shadow-panel">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="text-sm text-plw-ink">{event.summary}</p>
            {agentNames ? (
              <p className="mt-0.5 text-xs text-neutral-500">
                {agentNames[event.agentId] ?? 'Agente'}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Badge tone="navy">{ACTIVITY_KIND_LABELS[event.kind]}</Badge>
            <time dateTime={event.occurredAt} className="text-xs text-neutral-500">
              {formatDateTime(event.occurredAt)}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}
