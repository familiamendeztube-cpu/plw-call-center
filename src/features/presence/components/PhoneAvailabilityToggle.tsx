import { Pause, Play } from 'lucide-react';
import { usePresence } from '@/features/presence/context/presenceContext';
import { AVAILABILITY_LABELS, type Availability } from '@/features/presence/models/availability';
import { cx } from '@/components/ui/cx';

const OPTIONS: { value: Availability; icon: typeof Play }[] = [
  { value: 'active', icon: Play },
  { value: 'paused', icon: Pause },
];

export function PhoneAvailabilityToggle() {
  const { availability, setAvailability } = usePresence();

  return (
    <div
      role="radiogroup"
      aria-label="Disponibilidad"
      className="grid grid-cols-2 gap-2 rounded-2xl bg-neutral-100 p-1.5"
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
              'flex h-12 items-center justify-center gap-2 rounded-xl text-base font-semibold transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/60',
              selected
                ? value === 'active'
                  ? 'bg-success-600 text-white shadow-sm'
                  : 'bg-warning-600 text-plw-deep shadow-sm'
                : 'text-neutral-600 hover:bg-white hover:text-plw-ink'
            )}
          >
            <Icon size={18} aria-hidden="true" />
            {AVAILABILITY_LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}
