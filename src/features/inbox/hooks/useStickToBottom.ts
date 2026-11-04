import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const NEAR_BOTTOM_PX = 80;

/**
 * Chat scrolling, as in WhatsApp: the chat opens at the newest message, new messages glide into view
 * while the reader is at the bottom, and nothing moves while they read older ones. The reader's own
 * message (or note) always brings them down.
 *
 * @param active false until the messages have loaded, so the first jump lands on the real bottom
 * @param lastKey the newest entry; a change means something was added
 * @param lastIsOwn the newest entry was written by the agent
 */
export function useStickToBottom(active: boolean, lastKey: string | undefined, lastIsOwn: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const opened = useRef(false);
  const [away, setAway] = useState(false);

  const onScroll = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    pinned.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    setAway(!pinned.current);
  }, []);

  const scrollToBottom = useCallback(() => {
    const element = ref.current;
    element?.scrollTo?.({ top: element.scrollHeight, behavior: 'smooth' });
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element || !lastKey) return;
    if (!opened.current) {
      opened.current = true;
      element.scrollTop = element.scrollHeight;
      return;
    }
    if (pinned.current || lastIsOwn) scrollToBottom();
  }, [active, lastKey, lastIsOwn, scrollToBottom]);

  // Photos and videos take their space only once loaded: stay at the bottom while they do.
  // load and loadedmetadata do not bubble, so they are caught on the way down.
  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    const keepPinned = () => {
      if (pinned.current) element.scrollTop = element.scrollHeight;
    };
    element.addEventListener('load', keepPinned, true);
    element.addEventListener('loadedmetadata', keepPinned, true);
    // The chat box itself shrinks when the reply box grows or the window resizes.
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(keepPinned);
    resized?.observe(element);
    return () => {
      element.removeEventListener('load', keepPinned, true);
      element.removeEventListener('loadedmetadata', keepPinned, true);
      resized?.disconnect();
    };
  }, [active]);

  return { ref, onScroll, away, scrollToBottom };
}
