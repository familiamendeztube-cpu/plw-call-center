import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@/components/ui/cx';

/** The first tooltip waits, so passing the mouse over a control doesn't flash one. */
const OPEN_DELAY_MS = 600;
/** Once one has shown, the next opens at once (no delay, no animation) while the pointer moves
 *  between controls within this window. Shared by every tooltip on the page. */
const SKIP_DELAY_MS = 400;
const GAP_PX = 8;
let warmUntil = 0;

interface Placement {
  /** Center of the control, in viewport pixels. */
  x: number;
  /** `top` when shown below the control, `bottom` when above. */
  edge: { top: number } | { bottom: number };
  instant: boolean;
}

type TriggerProps = {
  'aria-label'?: string;
  'aria-describedby'?: string;
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
};

interface TooltipProps {
  /** Nothing to say right now: the control renders as-is (it stays mounted, keeping focus). */
  label: string | undefined;
  /** One button (or Button). It gets the hover and focus handlers. */
  children: ReactElement<TriggerProps>;
}

function isKeyboardFocus(element: HTMLElement): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * A small label over a control, replacing the browser's `title` (whose timing can't be changed).
 * Works on disabled buttons too, to say why they are disabled.
 */
export function Tooltip({ label, children }: TooltipProps) {
  const id = useId();
  const [placement, setPlacement] = useState<Placement | null>(null);
  const shown = useRef(false);
  const timer = useRef<number>();
  const bubble = useRef<HTMLSpanElement>(null);

  const open = (trigger: HTMLElement) => {
    window.clearTimeout(timer.current);
    const place = (instant: boolean) => {
      const rect = trigger.getBoundingClientRect();
      shown.current = true;
      setPlacement({
        x: rect.left + rect.width / 2,
        edge:
          rect.top < 48
            ? { top: rect.bottom + GAP_PX }
            : { bottom: window.innerHeight - rect.top + GAP_PX },
        instant,
      });
    };
    if (performance.now() < warmUntil) place(true);
    else timer.current = window.setTimeout(() => place(false), OPEN_DELAY_MS);
  };

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    if (shown.current) warmUntil = performance.now() + SKIP_DELAY_MS;
    shown.current = false;
    setPlacement(null);
  }, []);

  // Keep the bubble inside the window: centered on the control unless that would cut it off.
  useLayoutEffect(() => {
    const element = bubble.current;
    if (!placement || !element) return;
    const width = element.offsetWidth;
    const left = Math.min(
      Math.max(placement.x - width / 2, GAP_PX),
      window.innerWidth - width - GAP_PX
    );
    element.style.left = `${left}px`;
    element.style.transformOrigin = `${placement.x - left}px ${'top' in placement.edge ? 'top' : 'bottom'}`;
  }, [placement]);

  useEffect(() => {
    if (!placement) return undefined;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [placement, close]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!label) close();
  }, [label, close]);

  const props = children.props;
  // When the label only repeats the control's name, screen readers already say it.
  const describes = Boolean(label) && props['aria-label'] !== label;
  const trigger = !label
    ? children
    : cloneElement(children, {
        'aria-describedby': describes
          ? [props['aria-describedby'], id].filter(Boolean).join(' ')
          : props['aria-describedby'],
        onPointerEnter: (event: PointerEvent<HTMLElement>) => {
          props.onPointerEnter?.(event);
          if (event.pointerType === 'mouse') open(event.currentTarget);
        },
        onPointerLeave: (event: PointerEvent<HTMLElement>) => {
          props.onPointerLeave?.(event);
          close();
        },
        onPointerDown: (event: PointerEvent<HTMLElement>) => {
          props.onPointerDown?.(event);
          close();
        },
        onFocus: (event: FocusEvent<HTMLElement>) => {
          props.onFocus?.(event);
          if (isKeyboardFocus(event.currentTarget)) open(event.currentTarget);
        },
        onBlur: (event: FocusEvent<HTMLElement>) => {
          props.onBlur?.(event);
          close();
        },
      });

  return (
    <>
      {trigger}
      {describes ? (
        <span id={id} hidden>
          {label}
        </span>
      ) : null}
      {placement && label
        ? createPortal(
            <span
              ref={bubble}
              aria-hidden="true"
              style={placement.edge}
              className={cx(
                'pointer-events-none fixed z-[70] max-w-xs rounded-md bg-plw-deep px-2 py-1 text-xs font-medium text-white shadow-raised ring-1 ring-white/10',
                placement.instant ? '' : 'animate-tooltip-in'
              )}
            >
              {label}
            </span>,
            document.body
          )
        : null}
    </>
  );
}
