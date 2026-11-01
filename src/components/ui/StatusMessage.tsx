import type { ReactNode } from 'react';
import { cx } from '@/components/ui/cx';

interface StatusMessageProps {
  tone: 'empty' | 'error' | 'loading' | 'info';
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

const TONE_TEXT: Record<StatusMessageProps['tone'], string> = {
  empty: 'text-neutral-500',
  error: 'text-danger-700',
  loading: 'text-neutral-500',
  info: 'text-plw-navy',
};

export function StatusMessage({
  tone,
  title,
  description,
  icon,
  action,
  className,
}: StatusMessageProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        TONE_TEXT[tone],
        className
      )}
    >
      {icon ? <div className="text-plw-gold">{icon}</div> : null}
      <p className="font-medium text-plw-ink">{title}</p>
      {description ? <p className="max-w-sm text-sm">{description}</p> : null}
      {action}
    </div>
  );
}
