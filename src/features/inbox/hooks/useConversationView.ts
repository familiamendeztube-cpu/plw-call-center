import { useCallback, useEffect } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import { useAsync } from '@/app/useAsync';
import type { PrivateNote } from '@/features/leads/models/note';
import type { Prospect } from '@/features/leads/models/prospect';
import type { ConversationThread } from '@/features/inbox/services/inboxService';

export interface ConversationView {
  thread: ConversationThread;
  prospect: Prospect;
  notes: PrivateNote[];
}

const CONVERSATION_REFRESH_MS = 20_000;

type ConversationServices = ReturnType<typeof useAppServices>;

async function loadConversationView(
  { inbox, leads }: Pick<ConversationServices, 'inbox' | 'leads'>,
  conversationId: string | null
): Promise<ConversationView | null> {
  if (!conversationId) {
    return null;
  }
  const thread = await inbox.getThread(conversationId);
  if (!thread) {
    throw new Error('No se encontró la conversación.');
  }
  const prospect = await leads.getProspect(thread.conversation.prospectId);
  if (!prospect) {
    throw new Error('No se encontró el prospecto de esta conversación.');
  }
  const notes = await leads.listNotes(prospect.id);
  return { thread, prospect, notes };
}

export function useConversationView(conversationId: string | null) {
  const { inbox, leads } = useAppServices();

  const load = useCallback(
    () => loadConversationView({ inbox, leads }, conversationId),
    [inbox, leads, conversationId]
  );
  const result = useAsync<ConversationView | null>(load, [load]);
  const { updateData } = result;

  useEffect(() => {
    if (!conversationId) return;
    let active = true;
    let inFlight = false;
    const refresh = () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      loadConversationView({ inbox, leads }, conversationId)
        .then((data) => {
          if (active && data) updateData(() => data);
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    const timer = window.setInterval(refresh, CONVERSATION_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [inbox, leads, conversationId, updateData]);

  return result;
}
