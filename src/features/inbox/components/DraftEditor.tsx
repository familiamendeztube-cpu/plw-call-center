import { formatTime } from '@/app/dates';
import type { DraftSaveStatus } from '@/features/inbox/hooks/useDraftAutosave';

interface DraftEditorProps {
  conversationId: string;
  body: string;
  status: DraftSaveStatus;
  savedAt: string | null;
  onChange: (next: string) => void;
}

const STATUS_TEXT: Record<DraftSaveStatus, string> = {
  saved: 'Guardado',
  dirty: 'Cambios sin guardar',
  saving: 'Guardando...',
  conflict: 'Hay una versión más reciente. Sigue escribiendo para guardar tus cambios.',
  error: 'No se pudo guardar. Se reintentará al escribir de nuevo.',
};

export function DraftEditor({ conversationId, body, status, savedAt, onChange }: DraftEditorProps) {
  const statusText =
    status === 'saved' && savedAt ? `Guardado a las ${formatTime(savedAt)}` : STATUS_TEXT[status];
  const statusTone =
    status === 'error' || status === 'conflict' ? 'text-danger-700' : 'text-neutral-500';

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`draft-${conversationId}`} className="text-sm font-medium text-neutral-700">
        Borrador de respuesta
      </label>
      <textarea
        id={`draft-${conversationId}`}
        value={body}
        onChange={(event) => onChange(event.target.value)}
        rows={5}
        maxLength={4000}
        placeholder="Escribe tu respuesta para el cliente..."
        className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm leading-relaxed text-plw-ink placeholder:text-neutral-400 focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30"
      />
      <p className={`text-xs ${statusTone}`} aria-live="polite">
        {statusText}
      </p>
    </div>
  );
}
