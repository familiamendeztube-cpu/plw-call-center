import { cx } from '@/components/ui/cx';

interface PlwWordmarkProps {
  tone?: 'light' | 'dark';
  className?: string;
}

export function PlwWordmark({ tone = 'light', className }: PlwWordmarkProps) {
  const isLight = tone === 'light';
  return (
    <div className={cx('flex items-center gap-3', className)} aria-label="PLW">
      <div
        className={cx(
          'flex h-10 w-10 items-center justify-center rounded-lg border',
          isLight ? 'border-plw-gold-soft/70 text-plw-gold-soft' : 'border-plw-gold text-plw-gold'
        )}
      >
        <span className="font-display text-[15px] font-medium leading-none tracking-tight">PLW</span>
      </div>
      <div className="leading-tight">
        <p
          className={cx(
            'text-sm font-semibold tracking-wide',
            isLight ? 'text-white' : 'text-plw-ink'
          )}
        >
          Professional Latino Workers
        </p>
        <p className={cx('text-xs', isLight ? 'text-plw-gold-soft' : 'text-plw-gold')}>
          Costa Rica
        </p>
      </div>
    </div>
  );
}
