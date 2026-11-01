import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { AsyncState } from '@/app/useAsync';
import type { ReplyTarget } from '@/features/inbox/models/reply';

interface ReplyRecipientProps {
  state: AsyncState<ReplyTarget>;
  onRetry: () => void;
}

const BLOCKED_TEXT: Record<'sin_correo' | 'destinatario_no_confirmado', string> = {
  sin_correo:
    'Este cliente no tiene un correo al que responder, así que no se puede enviar la respuesta.',
  destinatario_no_confirmado:
    'No se pudo confirmar el destinatario de esta conversación, así que no se puede enviar.',
};

export function ReplyRecipient({ state, onRetry }: ReplyRecipientProps) {
  if (state.status === 'loading') {
    return <p className="text-sm text-neutral-500">Consultando destinatario...</p>;
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger-100 bg-danger-50 px-4 py-3">
        <p className="text-sm text-danger-700">{state.message}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
          Reintentar
        </Button>
      </div>
    );
  }

  const target = state.data;
  if (!target.ok) {
    return (
      <div className="rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-warning-700">
        <p className="text-sm font-medium">{BLOCKED_TEXT[target.reason]}</p>
      </div>
    );
  }

  return (
    <dl className="grid gap-1 rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
      <div className="flex gap-2">
        <dt className="w-16 shrink-0 font-medium text-neutral-500">Para</dt>
        <dd className="min-w-0 break-all text-plw-ink">{target.recipient}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="w-16 shrink-0 font-medium text-neutral-500">Asunto</dt>
        <dd className="min-w-0 break-words text-plw-ink">{target.subject}</dd>
      </div>
    </dl>
  );
}
