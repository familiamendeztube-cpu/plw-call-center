import { useAsync } from '@/app/useAsync';
import { useAppServices } from '@/app/ServicesContext';
import type { ReplyTarget } from '@/features/inbox/models/reply';

export function useReplyTarget(conversationId: string) {
  const { inbox } = useAppServices();
  const result = useAsync<ReplyTarget>(
    () => inbox.getReplyTarget(conversationId),
    [inbox, conversationId]
  );
  return result;
}
