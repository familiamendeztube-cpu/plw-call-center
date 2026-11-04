import { useState } from 'react';
import { Mail, StickyNote } from 'lucide-react';
import { cx } from '@/components/ui/cx';
import type { AgentId } from '@/features/auth/models/agent';
import type { Draft } from '@/features/inbox/models/conversation';
import type { OutboxItem } from '@/features/inbox/models/reply';
import type { Prospect } from '@/features/leads/models/prospect';
import { PrivateNoteComposer } from '@/features/leads/components/PrivateNoteComposer';
import { EmailReplyComposer } from '@/features/inbox/components/EmailReplyComposer';

type ReplyTab = 'email' | 'note';

interface ReplyPanelProps {
  conversationId: string;
  prospect: Prospect;
  agentId: AgentId;
  draft: Draft | null;
  outbox: OutboxItem[];
  onNoteSaved: () => void;
  /** False for customers who came by phone: only private notes, no email reply. */
  emailEnabled?: boolean;
}

const TAB_LABELS: Record<ReplyTab, string> = {
  email: 'Respuesta por correo',
  note: 'Nota privada',
};

export function ReplyPanel({
  conversationId,
  prospect,
  agentId,
  draft,
  outbox,
  onNoteSaved,
  emailEnabled = true,
}: ReplyPanelProps) {
  const tabs: ReplyTab[] = emailEnabled ? ['email', 'note'] : ['note'];
  const [tab, setTab] = useState<ReplyTab>(tabs[0]);

  return (
    <section aria-label="Redactar" className="border-t border-neutral-200 bg-white px-5 py-4">
      <div role="tablist" aria-label="Tipo de mensaje" className="mb-4 flex gap-2">
        {tabs.map((item) => {
          const selected = tab === item;
          const Icon = item === 'email' ? Mail : StickyNote;
          return (
            <button
              key={item}
              id={`reply-tab-${item}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`reply-panel-${item}`}
              onClick={() => setTab(item)}
              className={cx(
                'inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/50',
                selected
                  ? 'bg-plw-navy text-white'
                  : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
              )}
            >
              <Icon size={14} aria-hidden="true" />
              {TAB_LABELS[item]}
            </button>
          );
        })}
      </div>

      {tab === 'email' ? (
        <div role="tabpanel" id="reply-panel-email" aria-labelledby="reply-tab-email">
          <EmailReplyComposer
            key={conversationId}
            conversationId={conversationId}
            draft={draft}
            outbox={outbox}
          />
        </div>
      ) : (
        <div role="tabpanel" id="reply-panel-note" aria-labelledby="reply-tab-note">
          <PrivateNoteComposer prospectId={prospect.id} agentId={agentId} onSaved={onNoteSaved} />
        </div>
      )}
    </section>
  );
}
