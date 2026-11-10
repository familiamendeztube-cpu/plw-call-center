import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const NEAR_BOTTOM_PX = 80;
const distanceFromBottom = (element: HTMLElement) => element.scrollHeight - element.scrollTop;

/**
 * Chat scrolling, as in WhatsApp: the chat opens at the newest message, new messages glide into view
 * while the reader is at the bottom, and nothing moves while they read older ones. The reader's own
 * message (or note) always brings them down. Older messages added above leave the reader on the
 * message they were reading.
 *
 * @param active false until the messages have loaded, so the first jump lands on the real bottom
 * @param firstKey the oldest message; a change means older ones were added above
 * @param lastKey the newest entry; a change means something was added
 * @param lastIsOwn the newest entry was written by the agent
 */
export function useStickToBottom(
  active: boolean,
  firstKey: string | undefined,
  lastKey: string | undefined,
  lastIsOwn: boolean
) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const opened = useRef(false);
  const shownFirst = useRef(firstKey);
  // Kept current after every scroll and change: by the time older messages are on screen, the
  // height they added is already in scrollHeight.
  const fromBottom = useRef(0);
  const [away, setAway] = useState(false);

  const onScroll = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    fromBottom.current = distanceFromBottom(element);
    pinned.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    setAway(!pinned.current);
  }, []);

  const scrollToBottom = useCallback(() => {
    const element = ref.current;
    element?.scrollTo?.({ top: element.scrollHeight, behavior: 'smooth' });
  }, []);

  // Before the jump on opening, so the first messages to arrive are not taken for older ones.
  useLayoutEffect(() => {
    if (shownFirst.current === firstKey) return;
    shownFirst.current = firstKey;
    const element = ref.current;
    if (!element || !opened.current) return;
    element.scrollTop = element.scrollHeight - fromBottom.current;
    fromBottom.current = distanceFromBottom(element);
  }, [firstKey]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element || !lastKey) return;
    if (!opened.current) {
      opened.current = true;
      element.scrollTop = element.scrollHeight;
    } else if (pinned.current || lastIsOwn) {
      scrollToBottom();
    }
    fromBottom.current = distanceFromBottom(element);
  }, [active, lastKey, lastIsOwn, scrollToBottom]);

  // Photos and videos take their space only once loaded: stay at the bottom while they do.
  // load and loadedmetadata do not bubble, so they are caught on the way down.
  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    const keepPinned = () => {
      if (pinned.current) element.scrollTop = element.scrollHeight;
      fromBottom.current = distanceFromBottom(element);
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
