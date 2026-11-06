import type { ReactNode } from 'react';
import { ArrowDown } from 'lucide-react';
import { useAppServices } from '@/app/ServicesContext';
import { buildTimeline, type Message } from '@/features/inbox/models/message';
import { useConversationView } from '@/features/inbox/hooks/useConversationView';
import { useStickToBottom } from '@/features/inbox/hooks/useStickToBottom';
import { ThreadHeader } from '@/features/inbox/components/ThreadHeader';
import { ThreadTimeline } from '@/features/inbox/components/ThreadTimeline';
import { ReplyPanel } from '@/features/inbox/components/ReplyPanel';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import type { AgentId } from '@/features/auth/models/agent';
import type { Prospect } from '@/features/leads/models/prospect';

/** A chat channel such as WhatsApp, shown in place of the email thread. */
export interface ChatChannel {
  /** False while the chat loads; the view jumps to the newest message once it is true. */
  ready: boolean;
  /** Shown with the private notes in one timeline, like Chatwoot. */
  messages: Message[];
  /** Above the timeline: loading, errors, warnings, the connect form. */
  notice?: ReactNode;
  /** The channel's reply box, as the first reply tab; null while it cannot be used. */
  reply: ReactNode | null;
  replyLabel: string;
}

interface ConversationPaneProps {
  conversationId: string | null;
  agentId: AgentId;
  agentNames: Record<string, string>;
  /** Customers who came by phone: shown instead of the email thread; replies here are notes only. */
  channelDetails?: ReactNode;
  /** A chat channel: its messages replace the email thread and its reply box replaces email. */
  chat?: ChatChannel;
  /** Called after the stage or details are saved in the header. */
  onProspectChange?: (prospect: Prospect) => void;
}

export function ConversationPane({
  conversationId,
  agentId,
  agentNames,
  channelDetails,
  chat,
  onProspectChange,
}: ConversationPaneProps) {
  const { leads } = useAppServices();
  const { state, reload, updateData } = useConversationView(conversationId);

  const view = state.status === 'ready' ? state.data : null;
  const timeline = view
    ? buildTimeline(chat ? chat.messages : view.thread.messages, view.notes)
    : [];
  const last = timeline[timeline.length - 1];
  // Chats read bottom-up, like WhatsApp; email threads and call details keep opening at the top.
  const scroll = useStickToBottom(
    Boolean(chat?.ready && view),
    last?.id,
    last ? last.kind === 'note' || last.message.author === 'agent' : false
  );

  if (!conversationId) {
    return (
      <div className="flex h-full min-h-[24rem] items-center justify-center bg-white">
        <StatusMessage
          tone="empty"
          title="Selecciona una conversación para verla aquí."
          description="Las conversaciones de tu bandeja aparecen a la izquierda."
        />
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="flex h-full min-h-[24rem] items-center justify-center bg-white">
        <StatusMessage tone="loading" title="Cargando conversación..." />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-full min-h-[24rem] items-center justify-center bg-white">
        <StatusMessage
          tone="error"
          title="No se pudo abrir la conversación."
          description={state.message}
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Reintentar
            </Button>
          }
        />
      </div>
    );
  }

  if (!view) {
    return null;
  }

  const { thread, prospect } = view;
  const ownerName = prospect.assignedAgentId
    ? (agentNames[prospect.assignedAgentId] ?? 'Agente')
    : 'Sin asignar';

  const handleProspectChange = (updated: Prospect) => {
    updateData((current) => (current ? { ...current, prospect: updated } : current));
    onProspectChange?.(updated);
  };

  const handleNoteSaved = async () => {
    try {
      const notes = await leads.listNotes(prospect.id);
      updateData((current) => (current ? { ...current, notes } : current));
    } catch {
      reload();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <ThreadHeader
        prospect={prospect}
        ownerName={ownerName}
        onProspectChange={handleProspectChange}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroll.ref}
          onScroll={scroll.onScroll}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-plw-ivory/60 px-5 py-5"
        >
          {chat?.notice}
          {channelDetails}
          {(channelDetails || chat) && timeline.length === 0 ? null : (
            <ThreadTimeline
              entries={timeline}
              contactName={prospect.contactName || prospect.businessName}
              agentNames={agentNames}
            />
          )}
        </div>
        {chat && scroll.away ? (
          <button
            type="button"
            onClick={scroll.scrollToBottom}
            aria-label="Ir al mensaje más reciente"
            className="absolute bottom-3 right-5 flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-plw-navy shadow-panel transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/60"
          >
            <ArrowDown size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <ReplyPanel
        // A reply box that appears later (e.g. once Chatwoot is connected) opens on its own tab.
        key={chat?.reply ? 'chat' : 'notes'}
        conversationId={thread.conversation.id}
        prospect={prospect}
        agentId={agentId}
        draft={thread.draft}
        outbox={thread.outbox}
        onNoteSaved={handleNoteSaved}
        emailEnabled={!channelDetails && !chat}
        chatReply={chat?.reply ? { label: chat.replyLabel, content: chat.reply } : undefined}
      />
    </div>
  );
}
