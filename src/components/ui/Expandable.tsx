import { useEffect, useRef, useState, type ReactNode, type TransitionEvent } from 'react';

/** Browsers that can animate height to `auto` (interpolate-size, set on <html>). */
function canAnimateHeight(): boolean {
  return typeof CSS !== 'undefined' && CSS.supports?.('interpolate-size', 'allow-keywords');
}

interface ExpandableProps {
  open: boolean;
  children: ReactNode;
}

/**
 * Accordion body: opens from 0 to its natural height and closes back, then leaves the page.
 * While it closes it keeps showing what it showed when open (the parent may already have moved
 * on, e.g. loaded another call's transcript). Browsers without interpolate-size simply show and
 * hide it at once, as before.
 */
export function Expandable({ open, children }: ExpandableProps) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const lastOpenContent = useRef(children);
  if (open) lastOpenContent.current = children;

  useEffect(() => {
    if (!open && mounted && !canAnimateHeight()) setMounted(false);
  }, [open, mounted]);

  if (!mounted) return null;

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (!open && event.target === event.currentTarget && event.propertyName === 'height') {
      setMounted(false);
    }
  };

  return (
    <div className="expandable" data-open={open} onTransitionEnd={handleTransitionEnd}>
      {open ? children : lastOpenContent.current}
    </div>
  );
}
