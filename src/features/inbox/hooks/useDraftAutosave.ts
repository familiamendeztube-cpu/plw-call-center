import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppServices } from '@/app/ServicesContext';
import type { Draft } from '@/features/inbox/models/conversation';

const AUTOSAVE_DELAY_MS = 800;

export type DraftSaveStatus = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';

export interface DraftAutosave {
  body: string;
  setBody: (next: string) => void;
  status: DraftSaveStatus;
  savedAt: string | null;
  flush: () => Promise<boolean>;
}

export function useDraftAutosave(conversationId: string, draft: Draft | null): DraftAutosave {
  const { inbox } = useAppServices();
  const [body, setBodyState] = useState(draft?.body ?? '');
  const [status, setStatus] = useState<DraftSaveStatus>('saved');
  const [savedAt, setSavedAt] = useState<string | null>(draft?.updatedAt ?? null);
  const bodyRef = useRef(body);
  const savedBodyRef = useRef(body);
  const seqRef = useRef(0);
  const lastAppliedSeqRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const save = useCallback(async (): Promise<boolean> => {
    const text = bodyRef.current;
    if (text === savedBodyRef.current) return true;
    seqRef.current = Math.max(seqRef.current + 1, Date.now());
    const seq = seqRef.current;
    setStatus('saving');
    try {
      const result = await inbox.saveDraft(conversationId, text, seq);
      if (!result.applied) {
        if (seq === seqRef.current) setStatus('conflict');
        return false;
      }
      if (seq < lastAppliedSeqRef.current) return true;
      lastAppliedSeqRef.current = seq;
      savedBodyRef.current = text;
      setSavedAt(result.updatedAt);
      setStatus(bodyRef.current === text ? 'saved' : 'dirty');
      return true;
    } catch {
      setStatus('error');
      return false;
    }
  }, [inbox, conversationId]);

  const saveRef = useRef(save);
  saveRef.current = save;

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback(() => {
    cancelTimer();
    return saveRef.current();
  }, [cancelTimer]);

  const setBody = useCallback(
    (next: string) => {
      bodyRef.current = next;
      setBodyState(next);
      cancelTimer();
      if (next === savedBodyRef.current) {
        setStatus('saved');
        return;
      }
      setStatus('dirty');
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void saveRef.current();
      }, AUTOSAVE_DELAY_MS);
    },
    [cancelTimer]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        void saveRef.current();
      }
    };
  }, []);

  return { body, setBody, status, savedAt, flush };
}
