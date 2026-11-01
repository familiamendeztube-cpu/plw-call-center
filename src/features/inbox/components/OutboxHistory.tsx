import { formatTime } from '@/app/dates';
import {
  OUTBOX_STATUS_LABELS,
  type OutboxItem,
  type OutboxStatus,
} from '@/features/inbox/models/reply';

interface OutboxHistoryProps {
  items: OutboxItem[];
}

const STATUS_TONE: Record<OutboxStatus, string> = {
  queued: 'text-neutral-600',
  sending: 'text-neutral-600',
  confirming: 'text-warning-700',
  sent: 'text-success-700',
  failed: 'text-danger-700',
};

export function OutboxHistory({ items }: OutboxHistoryProps) {
  if (items.length === 0) return null;

  return (
    <ul
      aria-label="Envíos recientes"
      className="flex flex-col gap-1.5 border-t border-neutral-200 pt-3"
    >
      {items.slice(0, 3).map((item) => (
        <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className={`font-medium ${STATUS_TONE[item.status]}`}>
            {OUTBOX_STATUS_LABELS[item.status]}
          </span>
          <span className="text-neutral-500">
            {item.sentAt ? formatTime(item.sentAt) : item.lastError || ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
