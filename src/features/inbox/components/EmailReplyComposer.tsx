import { useEffect, useRef, useState } from 'react';
import { useDraftAutosave } from '@/features/inbox/hooks/useDraftAutosave';
import { useReplyTarget } from '@/features/inbox/hooks/useReplyTarget';
import { DraftEditor } from '@/features/inbox/components/DraftEditor';
import { OutboxHistory } from '@/features/inbox/components/OutboxHistory';
import { ReplyRecipient } from '@/features/inbox/components/ReplyRecipient';
import { ReplySendButton } from '@/features/inbox/components/ReplySendButton';
import type { Draft } from '@/features/inbox/models/conversation';
import {
  OUTBOX_PENDING_STATUSES,
  OUTBOX_STATUS_LABELS,
  type OutboxItem,
  type OutboxStatus,
} from '@/features/inbox/models/reply';

interface EmailReplyComposerProps {
  conversationId: string;
  draft: Draft | null;
  outbox: OutboxItem[];
}

function isPending(status: OutboxStatus): boolean {
  return OUTBOX_PENDING_STATUSES.includes(status);
}

export function EmailReplyComposer({ conversationId, draft, outbox }: EmailReplyComposerProps) {
  const target = useReplyTarget(conversationId);
  const autosave = useDraftAutosave(conversationId, draft);
  const [queuedStatus, setQueuedStatus] = useState<OutboxStatus | null>(null);

  useEffect(() => {
    setQueuedStatus(null);
  }, [outbox]);

  const latest = outbox[0];
  const activeStatus = queuedStatus ?? (latest && isPending(latest.status) ? latest.status : null);
  const targetReady = target.state.status === 'ready' && target.state.data.ok;
  const hasText = autosave.body.trim().length > 0;
  const sendDisabled = !targetReady || !hasText || activeStatus !== null;

  const latestBodyRef = useRef(autosave.body);
  latestBodyRef.current = autosave.body;

  const handleSent = (sentBody: string, status: OutboxStatus) => {
    setQueuedStatus(status);
    if (latestBodyRef.current === sentBody) autosave.setBody('');
  };

  return (
    <div className="flex flex-col gap-4">
      <ReplyRecipient state={target.state} onRetry={target.reload} />
      <DraftEditor
        conversationId={conversationId}
        body={autosave.body}
        status={autosave.status}
        savedAt={autosave.savedAt}
        onChange={autosave.setBody}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-medium text-neutral-600" aria-live="polite">
          {activeStatus ? OUTBOX_STATUS_LABELS[activeStatus] : ''}
        </p>
        <ReplySendButton
          conversationId={conversationId}
          disabled={sendDisabled}
          body={autosave.body}
          flush={autosave.flush}
          onSent={handleSent}
        />
      </div>
      <OutboxHistory items={outbox} />
    </div>
  );
}
