import type { ReactNode } from 'react';
import { cx } from '@/components/ui/cx';

export type BadgeTone = 'neutral' | 'navy' | 'gold' | 'success' | 'danger' | 'warning';

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
  navy: 'bg-plw-navy/10 text-plw-navy ring-plw-navy/15',
  gold: 'bg-plw-gold/15 text-plw-gold-soft ring-plw-gold/30',
  success: 'bg-success-50 text-success-700 ring-success-100',
  danger: 'bg-danger-50 text-danger-700 ring-danger-100',
  warning: 'bg-warning-50 text-warning-700 ring-warning-100',
};

export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONE_CLASSES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
