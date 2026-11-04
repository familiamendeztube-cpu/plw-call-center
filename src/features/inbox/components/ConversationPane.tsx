import type { ReactNode } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import { buildTimeline } from '@/features/inbox/models/message';
import { useConversationView } from '@/features/inbox/hooks/useConversationView';
import { ThreadHeader } from '@/features/inbox/components/ThreadHeader';
import { ThreadTimeline } from '@/features/inbox/components/ThreadTimeline';
import { ReplyPanel } from '@/features/inbox/components/ReplyPanel';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import type { AgentId } from '@/features/auth/models/agent';

interface ConversationPaneProps {
  conversationId: string | null;
  agentId: AgentId;
  agentNames: Record<string, string>;
  /** Customers who came by phone or WhatsApp: shown instead of the email thread; replies here are notes only. */
  channelDetails?: ReactNode;
}

export function ConversationPane({
  conversationId,
  agentId,
  agentNames,
  channelDetails,
}: ConversationPaneProps) {
  const { leads } = useAppServices();
  const { state, reload, updateData } = useConversationView(conversationId);

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

  if (!state.data) {
    return null;
  }

  const { thread, prospect, notes } = state.data;
  const timeline = buildTimeline(thread.messages, notes);
  const ownerName = prospect.assignedAgentId
    ? (agentNames[prospect.assignedAgentId] ?? 'Agente')
    : 'Sin asignar';

  const handleProspectChange = (updated: typeof prospect) => {
    updateData((current) => (current ? { ...current, prospect: updated } : current));
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
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-plw-ivory/60 px-5 py-5">
        {channelDetails}
        {channelDetails && timeline.length === 0 ? null : (
          <ThreadTimeline
            entries={timeline}
            contactName={prospect.contactName}
            agentNames={agentNames}
          />
        )}
      </div>
      <ReplyPanel
        conversationId={thread.conversation.id}
        prospect={prospect}
        agentId={agentId}
        draft={thread.draft}
        outbox={thread.outbox}
        onNoteSaved={handleNoteSaved}
        emailEnabled={!channelDetails}
      />
    </div>
  );
}
