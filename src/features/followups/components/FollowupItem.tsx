import { CalendarClock, Check } from 'lucide-react';
import { formatDateTime } from '@/app/dates';
import { Badge } from '@/components/ui/Badge';
import { cx } from '@/components/ui/cx';
import type { Followup } from '@/features/followups/models/followup';
import { FOLLOWUP_KIND_LABELS } from '@/features/followups/models/followup';

interface FollowupItemProps {
  followup: Followup;
  prospectName: string;
  ownerName?: string;
  overdue: boolean;
  onToggle?: (followup: Followup) => void;
}

export function FollowupItem({
  followup,
  prospectName,
  ownerName,
  overdue,
  onToggle,
}: FollowupItemProps) {
  const toggleable = onToggle !== undefined;

  return (
    <li className="flex items-start gap-3 rounded-xl border border-neutral-200/80 bg-white px-4 py-3.5 shadow-sm">
      {toggleable ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={followup.completed}
          aria-label={`Marcar como ${followup.completed ? 'pendiente' : 'completado'}: ${followup.title}`}
          onClick={() => onToggle(followup)}
          className={cx(
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/50',
            followup.completed
              ? 'border-success-600 bg-success-600 text-white'
              : 'border-neutral-300 bg-white hover:border-plw-gold'
          )}
        >
          {followup.completed ? <Check size={12} aria-hidden="true" /> : null}
        </button>
      ) : (
        <span
          aria-hidden="true"
          className={cx(
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
            followup.completed
              ? 'border-success-600 bg-success-600 text-white'
              : 'border-neutral-300 bg-white'
          )}
        >
          {followup.completed ? <Check size={12} /> : null}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p
          className={cx(
            'text-sm font-medium',
            followup.completed ? 'text-neutral-500 line-through' : 'text-plw-ink'
          )}
        >
          {followup.title}
        </p>
        <p className="mt-0.5 text-xs text-neutral-600">
          {prospectName}
          {ownerName ? ` · ${ownerName}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone="navy">{FOLLOWUP_KIND_LABELS[followup.kind]}</Badge>
          <span
            className={cx(
              'inline-flex items-center gap-1.5 text-xs',
              overdue && !followup.completed ? 'font-semibold text-danger-700' : 'text-neutral-500'
            )}
          >
            <CalendarClock size={12} aria-hidden="true" />
            <time dateTime={followup.dueAt}>
              {overdue && !followup.completed ? 'Vencido · ' : ''}
              {formatDateTime(followup.dueAt)}
            </time>
          </span>
        </div>
      </div>
    </li>
  );
}
