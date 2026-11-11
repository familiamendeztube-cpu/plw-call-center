import { LockKeyhole } from 'lucide-react';
import { formatDateTime } from '@/app/dates';
import { StatusMessage } from '@/components/ui/StatusMessage';
import type { TimelineEntry } from '@/features/inbox/models/message';

/** WhatsApp photos, videos and voice notes play in place; other files open in a new tab. */
function Attachment({ kind, url, onDark }: { kind: string; url: string; onDark: boolean }) {
  if (kind === 'audio') {
    return <audio controls preload="none" src={url} className="mt-2 w-64 max-w-full" />;
  }
  if (kind === 'video') {
    return (
      <video
        controls
        preload="metadata"
        src={url}
        className="mt-2 max-h-64 w-72 max-w-full rounded-lg bg-black"
      />
    );
  }
  if (kind === 'image') {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-2 block">
        <img
          src={url}
          alt="Foto enviada por WhatsApp"
          loading="lazy"
          className="max-h-64 max-w-full rounded-lg"
        />
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`mt-1 block text-sm font-medium underline ${onDark ? 'text-white' : 'text-plw-navy'}`}
    >
      Abrir archivo
    </a>
  );
}

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
              <p className="flex items-center gap-2 text-xs font-semibold text-plw-gold-soft">
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
                    : 'text-xs font-semibold text-white'
                }
              >
                {fromCustomer ? contactName : 'Agente'}
              </p>
              {entry.message.body ? (
                <p
                  className={
                    fromCustomer
                      ? 'mt-1 whitespace-pre-line text-sm leading-relaxed text-plw-ink'
                      : 'mt-1 whitespace-pre-line text-sm leading-relaxed text-white'
                  }
                >
                  {entry.message.body}
                </p>
              ) : null}
              {entry.message.attachments?.map((file) => (
                <Attachment key={file.url} {...file} onDark={!fromCustomer} />
              ))}
              <time
                dateTime={entry.message.sentAt}
                className={
                  fromCustomer
                    ? 'mt-2 block text-xs text-neutral-500'
                    : 'mt-2 block text-xs text-white'
                }
              >
                {formatDateTime(entry.message.sentAt)}
                {entry.message.failed ? ' · No se entregó' : ''}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
