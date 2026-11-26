import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SendHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { ConversationPane, type ChatChannel } from '@/features/inbox/components/ConversationPane';
import { useSmsThread } from '@/features/sms/hooks/useSms';
import { MAX_SMS, PLW_US_SMS_NUMBER } from '@/features/sms/models/sms';
import type { AgentId } from '@/features/auth/models/agent';
import type { Prospect } from '@/features/leads/models/prospect';

const REPLY_LABEL = 'Respuesta por SMS';

interface SmsConversationProps {
  /** The customer's PLW conversation: header, sales stage and private notes. */
  conversationId: string;
  prospect: Prospect;
  /** The signed-in agent; the administrator has none and only reads. */
  agentId?: AgentId;
  agentNames: Record<string, string>;
  /** Called after the stage or details are saved in the header. */
  onProspectChange?: (prospect: Prospect) => void;
}

/**
 * The customer's texts with PLW's US number, in one timeline with the private notes. The agent
 * may answer only after the customer texted first, and never after STOP (owner's rule).
 */
export function SmsConversation({
  conversationId,
  prospect,
  agentId,
  agentNames,
  onProspectChange,
}: SmsConversationProps) {
  const { state, reload, send, markRead } = useSmsThread(prospect.id);
  const shown = state.status === 'ready';

  // Only the agent's own visit clears the unread mark, not the administrator's look.
  useEffect(() => {
    if (shown && agentId) markRead();
  }, [shown, agentId, markRead]);

  const waiting = { ready: false, messages: [], reply: null, replyLabel: REPLY_LABEL };
  let chat: ChatChannel;
  if (state.status === 'loading') {
    chat = { ...waiting, notice: <StatusMessage tone="loading" title="Cargando los SMS..." /> };
  } else if (state.status === 'error') {
    chat = {
      ...waiting,
      notice: (
        <StatusMessage
          tone="error"
          title="No se pudieron abrir los SMS."
          description={state.message}
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Reintentar
            </Button>
          }
        />
      ),
    };
  } else {
    const thread = state.data;
    const locked = !thread.texted
      ? `Este cliente todavía no le ha escrito por SMS a PLW. Solo puede escribirle después de que el cliente escriba primero al ${PLW_US_SMS_NUMBER}. Si habla con él por teléfono, pídale que le mande un mensaje a ese número.`
      : thread.stopped
        ? 'El cliente pidió no recibir más mensajes (STOP). Podrá escribirle de nuevo solo si el cliente vuelve a escribir.'
        : null;
    chat = {
      ready: true,
      messages: thread.messages,
      replyLabel: REPLY_LABEL,
      notice: locked ? (
        <p
          role="status"
          className="rounded-lg border border-plw-gold/60 bg-plw-gold-soft/15 px-4 py-3 text-sm text-plw-ink"
        >
          {locked}
        </p>
      ) : undefined,
      reply: locked ? null : <SmsComposer prospectId={prospect.id} onSend={send} />,
    };
  }

  return (
    <ConversationPane
      conversationId={conversationId}
      agentId={agentId}
      agentNames={agentNames}
      chat={chat}
      onProspectChange={onProspectChange}
    />
  );
}

function SmsComposer({
  prospectId,
  onSend,
}: {
  prospectId: string;
  onSend: (body: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = `sms-reply-${prospectId}`;
  const ready = text.trim().length > 0 && text.trim().length <= MAX_SMS;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(text.trim());
      setText('');
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'No se pudo enviar el SMS.';
      setError(`${message} Revise los mensajes antes de enviarlo otra vez.`);
    } finally {
      setSending(false);
    }
  };

  // Grows with the text up to about six lines, like the WhatsApp box.
  useEffect(() => {
    const box = field.current;
    if (!box) return;
    box.style.height = 'auto';
    const border = box.offsetHeight - box.clientHeight + 1;
    box.style.height = `${Math.min(box.scrollHeight + border, 160)}px`;
  }, [text]);

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <label htmlFor={fieldId} className="sr-only">
          Mensaje SMS
        </label>
        <textarea
          id={fieldId}
          ref={field}
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={1}
          maxLength={MAX_SMS}
          placeholder="Escriba un SMS"
          className="max-h-40 min-h-10 flex-1 resize-none overflow-y-auto rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm leading-relaxed text-plw-ink placeholder:text-neutral-400 focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30"
        />
        <Button type="submit" className="shrink-0" disabled={!ready || sending} aria-label="Enviar por SMS">
          <SendHorizontal size={16} aria-hidden="true" />
          {sending ? 'Enviando...' : 'Enviar'}
        </Button>
      </div>
      <p className="text-right text-xs text-neutral-500">Sale del número de PLW {PLW_US_SMS_NUMBER}</p>
      {error ? (
        <p role="alert" className="text-xs text-danger-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}
