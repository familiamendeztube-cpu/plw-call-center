import type { ReactNode } from 'react';
import { cx } from '@/components/ui/cx';

interface IconSwapProps {
  /** Show `to` instead of `from`. */
  swapped: boolean;
  from: ReactNode;
  to: ReactNode;
}

const LAYER =
  'col-start-1 row-start-1 flex transition-[opacity,transform,filter] duration-200 ease-out-strong';
const SHOWN = 'scale-100 opacity-100 blur-0';
const HIDDEN = 'scale-[0.25] opacity-0 blur-[4px]';

/**
 * Two icons in the same spot (copy → copied, mic → muted). The outgoing one shrinks and blurs
 * away while the new one sharpens in, so the change reads as one icon turning into another
 * instead of a hard cut. Both stay mounted so the swap can run either way, even mid-transition.
 */
export function IconSwap({ swapped, from, to }: IconSwapProps) {
  return (
    <span aria-hidden="true" className="inline-grid shrink-0 place-items-center">
      <span className={cx(LAYER, swapped ? HIDDEN : SHOWN)}>{from}</span>
      <span className={cx(LAYER, swapped ? SHOWN : HIDDEN)}>{to}</span>
    </span>
  );
}
