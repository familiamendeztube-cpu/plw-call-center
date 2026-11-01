import type { ReactNode } from 'react';
import { cx } from '@/components/ui/cx';

interface PanelProps {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}

export function Panel({ children, className, as: Tag = 'div' }: PanelProps) {
  return (
    <Tag className={cx('rounded-xl border border-neutral-200/80 bg-white shadow-panel', className)}>
      {children}
    </Tag>
  );
}
