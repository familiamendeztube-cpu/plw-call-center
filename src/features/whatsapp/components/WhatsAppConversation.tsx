import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Paperclip, SendHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { ConversationPane, type ChatChannel } from '@/features/inbox/components/ConversationPane';
import {
  connectChatwoot,
  disconnectChatwoot,
  MAX_FILE_BYTES,
  useWhatsAppThread,
  WHATSAPP_FILE_TYPES,
  type WhatsAppOutgoing,
} from '@/features/whatsapp/hooks/useWhatsApp';
import { TemplateComposer } from '@/features/whatsapp/components/TemplateComposer';
import type { AgentId } from '@/features/auth/models/agent';
import type { Prospect } from '@/features/leads/models/prospect';

const MAX_TEXT = 4096; // WhatsApp's limit for one text message.
const MAX_CAPTION = 1024; // WhatsApp's limit for the text sent with a file.
const REPLY_LABEL = 'Respuesta por WhatsApp';

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface WhatsAppConversationProps {
  /** The customer's PLW conversation: header, sales stage and private notes. */
  conversationId: string;
  prospect: Prospect;
  agentId: AgentId;
  agentNames: Record<string, string>;
  /** Called once the chat is on screen: the server has marked it read. */
  onRead?: () => void;
}

/**
 * The customer's WhatsApp chat in Chatwoot, laid out like Chatwoot: one timeline with the private
 * notes that opens at the newest message, and the reply box pinned below it.
 */
export function WhatsAppConversation({
  conversationId,
  prospect,
  agentId,
  agentNames,
  onRead,
}: WhatsAppConversationProps) {
  const { state, reload, send } = useWhatsAppThread(prospect.id);
  // The server marks the chat read only when it could show it.
  const shown = state.status === 'ready' && state.data.connected;
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (shown) onRead?.();
  }, [shown, onRead]);

  const disconnect = async () => {
    setDisconnecting(true);
    await disconnectChatwoot().catch(() => undefined);
    setDisconnecting(false);
    reload();
  };

  const waiting = { ready: false, messages: [], reply: null, replyLabel: REPLY_LABEL };
  let chat: ChatChannel;
  if (state.status === 'loading') {
    chat = {
      ...waiting,
      notice: <StatusMessage tone="loading" title="Cargando el chat de WhatsApp..." />,
    };
  } else if (state.status === 'error') {
    chat = {
      ...waiting,
      notice: (
        <StatusMessage
          tone="error"
          title="No se pudo abrir el chat de WhatsApp."
          description={state.message}
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Reintentar
            </Button>
          }
        />
      ),
    };
  } else if (!state.data.connected) {
    chat = { ...waiting, notice: <ChatwootConnect onConnected={reload} /> };
  } else {
    const thread = state.data;
    chat = {
      ready: true,
      messages: thread.messages,
      replyLabel: REPLY_LABEL,
      notice: thread.ambiguous ? (
        <p
          role="status"
          className="rounded-lg border border-plw-gold/60 bg-plw-gold-soft/15 px-4 py-3 text-sm text-plw-ink"
        >
          Este número de WhatsApp pertenece a varios clientes. Confirma con quién hablas antes de
          enviar información de su cuenta.
        </p>
      ) : undefined,
      reply: (
        <div className="flex flex-col gap-2">
          {thread.canReply ? (
            <WhatsAppComposer prospectId={prospect.id} onSend={send} />
          ) : (
            <TemplateComposer prospect={prospect} onSend={send} />
          )}
          <p className="text-right text-xs text-neutral-500">
            Respondes en Chatwoot como {thread.sender} ·{' '}
            <button
              type="button"
              disabled={disconnecting}
              onClick={() => void disconnect()}
              className="font-medium text-plw-navy underline hover:text-plw-ink disabled:opacity-50"
            >
              Desconectar
            </button>
          </p>
        </div>
      ),
    };
  }

  return (
    <ConversationPane
      conversationId={conversationId}
      agentId={agentId}
      agentNames={agentNames}
      chat={chat}
    />
  );
}

/** Each agent links their own Chatwoot user once, so replies carry their own name. */
function ChatwootConnect({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await connectChatwoot(token);
      setToken('');
      onConnected();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo conectar Chatwoot.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4"
    >
      <p className="font-medium text-plw-ink">Conecta tu cuenta de Chatwoot</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
        <li>Entra a Chatwoot con tu propio usuario, no con el de otra persona.</li>
        <li>Abre tu foto (abajo a la izquierda) → Configuración del perfil.</li>
        <li>Copia el «Token de acceso» y pégalo aquí. Tus respuestas saldrán con tu nombre.</li>
      </ol>
      <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
        Token de acceso de Chatwoot
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-normal text-plw-ink focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30"
        />
      </label>
      {error ? (
        <p role="alert" className="text-xs text-danger-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="self-end" disabled={!token.trim() || saving}>
        {saving ? 'Verificando...' : 'Conectar'}
      </Button>
    </form>
  );
}

function WhatsAppComposer({
  prospectId,
  onSend,
}: {
  prospectId: string;
  onSend: (outgoing: WhatsAppOutgoing) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = `whatsapp-reply-${prospectId}`;
  // With a file, the text goes out as its caption, which WhatsApp keeps shorter.
  const limit = file ? MAX_CAPTION : MAX_TEXT;
  const ready = (text.trim().length > 0 || file !== null) && text.trim().length <= limit;

  const choose = (chosen: File | undefined) => {
    if (picker.current) picker.current.value = ''; // so the same file can be picked again
    if (!chosen) return;
    if (chosen.size > MAX_FILE_BYTES) {
      setError('Ese archivo pesa más de 16 MB, el máximo de WhatsApp.');
      return;
    }
    setError(null);
    setFile(chosen);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend({ text: text.trim(), file: file ?? undefined });
      setText('');
      setFile(null);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'No se pudo enviar el mensaje.';
      setError(`${message} Revisa el chat antes de enviarlo otra vez.`);
    } finally {
      setSending(false);
    }
  };

  // Grows with the text, like WhatsApp, up to about six lines.
  const grow = (field: HTMLTextAreaElement) => {
    field.style.height = 'auto';
    // scrollHeight leaves out the border, and lines are fractional pixels tall: without both
    // a needless scrollbar shows.
    const border = field.offsetHeight - field.clientHeight + 1;
    field.style.height = `${Math.min(field.scrollHeight + border, 160)}px`;
  };
  useEffect(() => {
    if (field.current) grow(field.current);
  }, [text]);

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {file ? (
        <p className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-plw-ink">
          <Paperclip size={14} aria-hidden="true" className="shrink-0 text-neutral-500" />
          <span className="min-w-0 truncate">{file.name}</span>
          <span className="shrink-0 text-xs text-neutral-500">{fileSize(file.size)}</span>
          <button
            type="button"
            aria-label={`Quitar ${file.name}`}
            onClick={() => setFile(null)}
            className="ml-auto shrink-0 rounded p-1 text-neutral-500 hover:text-plw-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/60"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </p>
      ) : null}
      {/* One row, as in WhatsApp: attach, type, send. */}
      <div className="flex items-end gap-2">
        <input
          ref={picker}
          type="file"
          accept={WHATSAPP_FILE_TYPES}
          aria-label="Archivo para enviar por WhatsApp"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => choose(event.target.files?.[0])}
        />
        <Button
          variant="secondary"
          className="w-10 shrink-0 px-0"
          disabled={sending}
          onClick={() => picker.current?.click()}
          aria-label={file ? 'Cambiar el archivo' : 'Adjuntar foto, video o documento'}
          title="Adjuntar foto, video o documento"
        >
          <Paperclip size={16} aria-hidden="true" />
        </Button>
        <label htmlFor={fieldId} className="sr-only">
          Mensaje de WhatsApp
        </label>
        <textarea
          id={fieldId}
          ref={field}
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={1}
          maxLength={MAX_TEXT}
          placeholder={file ? 'Texto opcional para acompañar el archivo' : 'Escribe un mensaje'}
          className="max-h-40 min-h-10 flex-1 resize-none overflow-y-auto rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm leading-relaxed text-plw-ink placeholder:text-neutral-400 focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30"
        />
        <Button
          type="submit"
          className="shrink-0"
          disabled={!ready || sending}
          aria-label="Enviar por WhatsApp"
        >
          <SendHorizontal size={16} aria-hidden="true" />
          {sending ? 'Enviando...' : 'Enviar'}
        </Button>
      </div>
      {file && text.trim().length > MAX_CAPTION ? (
        <p className="text-xs text-danger-700">
          Con un archivo, el texto puede tener hasta {MAX_CAPTION} caracteres.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-danger-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}
