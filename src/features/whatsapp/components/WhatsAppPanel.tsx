import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { buildTimeline } from '@/features/inbox/models/message';
import { ThreadTimeline } from '@/features/inbox/components/ThreadTimeline';
import {
  connectChatwoot,
  disconnectChatwoot,
  useWhatsAppThread,
  type WhatsAppOutgoing,
} from '@/features/whatsapp/hooks/useWhatsApp';
import { TemplateComposer } from '@/features/whatsapp/components/TemplateComposer';
import type { Prospect } from '@/features/leads/models/prospect';

const MAX_TEXT = 4096; // WhatsApp's limit for one text message.

interface WhatsAppPanelProps {
  prospect: Prospect;
  agentNames: Record<string, string>;
  /** Called once the chat is on screen: the server has marked it read. */
  onRead?: () => void;
}

/** The customer's WhatsApp chat in Chatwoot, answered from PLW. */
export function WhatsAppPanel({ prospect, agentNames, onRead }: WhatsAppPanelProps) {
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

  if (state.status === 'loading') {
    return <StatusMessage tone="loading" title="Cargando el chat de WhatsApp..." />;
  }
  if (state.status === 'error') {
    return (
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
    );
  }

  if (!state.data.connected) return <ChatwootConnect onConnected={reload} />;

  return (
    <section aria-label="Chat de WhatsApp" className="flex flex-col gap-4">
      {state.data.ambiguous ? (
        <p
          role="status"
          className="rounded-lg border border-plw-gold/60 bg-plw-gold-soft/15 px-4 py-3 text-sm text-plw-ink"
        >
          Este número de WhatsApp pertenece a varios clientes. Confirma con quién hablas antes de
          enviar información de su cuenta.
        </p>
      ) : null}
      <ThreadTimeline
        entries={buildTimeline(state.data.messages, [])}
        contactName={prospect.contactName || prospect.businessName}
        agentNames={agentNames}
      />
      {state.data.canReply ? (
        <WhatsAppComposer prospectId={prospect.id} onSend={send} />
      ) : (
        <TemplateComposer prospect={prospect} onSend={send} />
      )}
      <p className="flex flex-wrap items-center justify-end gap-2 text-xs text-neutral-500">
        Respondes en Chatwoot como {state.data.sender}.
        <Button
          variant="ghost"
          size="sm"
          disabled={disconnecting}
          onClick={() => void disconnect()}
        >
          Desconectar
        </Button>
      </p>
    </section>
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
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = `whatsapp-reply-${prospectId}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend({ text: body });
      setText('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo enviar el mensaje.');
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4"
    >
      <label htmlFor={fieldId} className="text-sm font-medium text-neutral-700">
        Respuesta por WhatsApp
      </label>
      <textarea
        id={fieldId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        maxLength={MAX_TEXT}
        placeholder="Escribe tu mensaje para el cliente..."
        className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm leading-relaxed text-plw-ink placeholder:text-neutral-400 focus:border-plw-gold focus:outline-none focus:ring-2 focus:ring-plw-gold/30"
      />
      {error ? (
        <p role="alert" className="text-xs text-danger-700">
          {error} Revisa el chat antes de enviarlo otra vez.
        </p>
      ) : null}
      <Button type="submit" className="self-end" disabled={!text.trim() || sending}>
        {sending ? 'Enviando...' : 'Enviar por WhatsApp'}
      </Button>
    </form>
  );
}
