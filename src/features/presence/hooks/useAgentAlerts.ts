import { useEffect, useRef } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import type { AgentId } from '@/features/auth/models/agent';

// Runs while the tab is hidden too: that is when the agent needs the nudge.
const ALERT_CHECK_MS = 60_000;

export function titleWithCount(base: string, count: number): string {
  return count > 0 ? `(${count}) ${base}` : base;
}

/**
 * Unread messages and follow-ups that came due: counted in the tab title, and announced with a
 * desktop notification when the tab is in the background and the agent allowed it.
 */
export function useAgentAlerts(agentId: AgentId) {
  const { inbox, followups } = useAppServices();
  const previous = useRef<{ unread: number; due: Set<string> } | null>(null);

  useEffect(() => {
    const baseTitle = document.title;
    let active = true;
    previous.current = null;

    const check = async () => {
      try {
        const [conversations, list] = await Promise.all([
          inbox.listConversations(agentId),
          followups.listFollowups(agentId),
        ]);
        if (!active) return;
        const unread = conversations.filter((conversation) => conversation.unread).length;
        const now = Date.now();
        const due = list.filter((item) => !item.completed && Date.parse(item.dueAt) <= now);
        document.title = titleWithCount(baseTitle, unread + due.length);

        const before = previous.current;
        previous.current = { unread, due: new Set(due.map((item) => item.id)) };
        if (!before || document.visibilityState === 'visible') return;
        const newlyDue = due.filter((item) => !before.due.has(item.id));
        const lines = [
          unread > before.unread
            ? unread === 1
              ? 'Tienes un mensaje sin leer.'
              : `Tienes ${unread} mensajes sin leer.`
            : '',
          newlyDue.length > 0 ? `Seguimiento pendiente: ${newlyDue[0].title}` : '',
        ].filter(Boolean);
        if (lines.length > 0) notify(lines.join(' '));
      } catch {
        // The next check retries.
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), ALERT_CHECK_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.title = baseTitle;
    };
  }, [agentId, inbox, followups]);
}

function notify(body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  // One tag: a newer alert replaces the older one instead of stacking.
  new Notification('PLW Call Center', { body, tag: 'plw-agent-alert' });
}
