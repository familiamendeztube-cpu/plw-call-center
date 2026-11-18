import { useCallback, useRef } from 'react';
import { prefersReducedMotion } from '@/components/ui/motion';

/*
 * The "no" shake for a rejected password or PIN: a few side-to-side moves on the X axis
 * that die down, like a head shaking.
 *
 * TODO(you): fill SHAKE_KEYFRAMES (and tune SHAKE_DURATION_MS). Each frame is a
 * { transform: 'translateX(…px)' }, start and end at 0. Until it is filled the field still turns
 * red, it just doesn't move.
 */
const SHAKE_KEYFRAMES: Keyframe[] = [];
const SHAKE_DURATION_MS = 400;

/**
 * Returns a ref for the element to shake and a function that shakes it. Calling it again while a
 * shake is running starts over, so every failed attempt gets its own shake. Skipped when the
 * person asked for reduced motion: the red state still tells them.
 */
export function useShake<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const shake = useCallback(() => {
    const element = ref.current;
    if (!element || typeof element.animate !== 'function' || prefersReducedMotion()) return;
    element.animate(SHAKE_KEYFRAMES, { duration: SHAKE_DURATION_MS, easing: 'ease-out' });
  }, []);
  return [ref, shake] as const;
}
