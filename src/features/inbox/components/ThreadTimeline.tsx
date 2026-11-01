import { LockKeyhole } from 'lucide-react';
import { formatDateTime } from '@/app/dates';
import { StatusMessage } from '@/components/ui/StatusMessage';
import type { TimelineEntry } from '@/features/inbox/models/message';

interface ThreadTimelineProps {
  entries: TimelineEntry[];
  contactName: string;
  agentNames: Record<string, string>;
}

export function ThreadTimeline({ entries, contactName, agentNames }: ThreadTimelineProps) {
  if (entries.length === 0) {
    return <StatusMessage tone="empty" title="Esta conversación aún no tiene mensajes." />;
  }

  return (
    <ol aria-label="Historial de la conversación" className="flex flex-col gap-4">
      {entries.map((entry) => {
        if (entry.kind === 'note') {
          const authorName = agentNames[entry.note.agentId] ?? 'Agente';
          return (
            <li
              key={entry.id}
              className="rounded-xl border border-dashed border-plw-gold/60 bg-plw-gold-soft/15 px-4 py-3"
            >
              <p className="flex items-center gap-2 text-xs font-semibold text-[#7A5A16]">
                <LockKeyhole size={12} aria-hidden="true" />
                Nota privada · {authorName}
              </p>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-plw-ink">
                {entry.note.body}
              </p>
              <time dateTime={entry.note.createdAt} className="mt-2 block text-xs text-neutral-500">
                {formatDateTime(entry.note.createdAt)}
              </time>
            </li>
          );
        }

        const fromCustomer = entry.message.author === 'customer';
        return (
          <li key={entry.id} className={fromCustomer ? 'flex justify-start' : 'flex justify-end'}>
            <div
              className={
                fromCustomer
                  ? 'max-w-[85%] rounded-2xl rounded-tl-sm border border-neutral-200 bg-white px-4 py-3 shadow-sm'
                  : 'max-w-[85%] rounded-2xl rounded-tr-sm bg-plw-navy px-4 py-3 text-white shadow-sm'
              }
            >
              <p
                className={
                  fromCustomer
                    ? 'text-xs font-semibold text-neutral-500'
                    : 'text-xs font-semibold text-white/75'
                }
              >
                {fromCustomer ? contactName : 'Agente'}
              </p>
              <p
                className={
                  fromCustomer
                    ? 'mt-1 whitespace-pre-line text-sm leading-relaxed text-plw-ink'
                    : 'mt-1 whitespace-pre-line text-sm leading-relaxed text-white'
                }
              >
                {entry.message.body}
              </p>
              <time
                dateTime={entry.message.sentAt}
                className={
                  fromCustomer
                    ? 'mt-2 block text-xs text-neutral-500'
                    : 'mt-2 block text-xs text-white/70'
                }
              >
                {formatDateTime(entry.message.sentAt)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
