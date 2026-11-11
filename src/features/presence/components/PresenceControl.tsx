import { Pause, Play } from 'lucide-react';
import { usePresence } from '@/features/presence/context/presenceContext';
import type { Availability, DisplayStatus } from '@/features/presence/models/availability';
import {
  AVAILABILITY_LABELS,
  DISPLAY_STATUS_LABELS,
} from '@/features/presence/models/availability';
import { cx } from '@/components/ui/cx';

interface PresenceControlProps {
  displayStatus: DisplayStatus;
}

const STATUS_DOT: Record<DisplayStatus, string> = {
  active: 'bg-success-500',
  paused: 'bg-warning-600',
  in_call: 'bg-plw-gold-soft',
  after_call: 'bg-plw-gold',
};

const OPTIONS: { value: Availability; icon: typeof Play }[] = [
  { value: 'active', icon: Play },
  { value: 'paused', icon: Pause },
];

export function PresenceControl({ displayStatus }: PresenceControlProps) {
  const { availability, setAvailability } = usePresence();

  return (
    <div className="flex items-center gap-3">
      <span className="hidden items-center gap-2 text-sm font-medium text-white sm:inline-flex">
        <span
          aria-hidden="true"
          className={cx('h-2.5 w-2.5 rounded-full ring-2 ring-white/20', STATUS_DOT[displayStatus])}
        />
        <span aria-live="polite">{DISPLAY_STATUS_LABELS[displayStatus]}</span>
      </span>
      <div
        role="radiogroup"
        aria-label="Disponibilidad"
        className="flex rounded-full bg-plw-deep/70 p-1 ring-1 ring-white/10"
      >
        {OPTIONS.map(({ value, icon: Icon }) => {
          const selected = availability === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setAvailability(value)}
              className={cx(
                'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors duration-150',
                selected
                  ? value === 'active'
                    ? 'bg-success-600 text-white shadow-sm'
                    : 'bg-warning-600 text-plw-deep shadow-sm'
                  : 'text-white/70 hover:text-white'
              )}
            >
              <Icon size={14} aria-hidden="true" />
              {AVAILABILITY_LABELS[value]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
