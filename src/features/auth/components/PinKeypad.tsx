import { useEffect } from 'react';
import { Delete } from 'lucide-react';
import { PIN_LENGTH } from '@/features/auth/models/demoAccess';
import { cx } from '@/components/ui/cx';

interface PinKeypadProps {
  value: string;
  onDigit: (digit: string) => void;
  onDelete: () => void;
  disabled?: boolean;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'] as const;

const KEY_BASE =
  'flex h-14 w-full items-center justify-center rounded-xl border text-2xl font-semibold shadow-sm transition-[transform,background-color,border-color] duration-150 ease-out enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:h-16';

export function PinKeypad({ value, onDigit, onDelete, disabled = false }: PinKeypadProps) {
  useEffect(() => {
    if (disabled) {
      return undefined;
    }
    const handleKey = (event: KeyboardEvent) => {
      // A code typed into the device registration fields must not count as a PIN.
      if (event.target instanceof HTMLInputElement) {
        return;
      }
      if (/^\d$/.test(event.key)) {
        onDigit(event.key);
      } else if (event.key === 'Backspace') {
        onDelete();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [disabled, onDigit, onDelete]);

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <div
        className="flex items-center gap-4"
        role="status"
        aria-label={`PIN: ${value.length} de ${PIN_LENGTH} dígitos ingresados`}
      >
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={cx(
              'h-3.5 w-3.5 rounded-full border-2 transition-[transform,background-color,border-color] duration-150 ease-out',
              index < value.length
                ? 'scale-110 border-plw-gold-soft bg-plw-gold-soft'
                : 'border-neutral-400 bg-transparent'
            )}
          />
        ))}
      </div>
      <div className="w-full max-w-[16.5rem]">
        <div className="grid grid-cols-3 gap-3" role="group" aria-label="Teclado numérico">
          {KEYS.map((key, index) => {
            if (key === '') {
              return <span key={`empty-${index}`} aria-hidden="true" />;
            }
            if (key === 'delete') {
              return (
                <button
                  key={key}
                  type="button"
                  disabled={disabled || value.length === 0}
                  onClick={onDelete}
                  aria-label="Borrar último dígito"
                  className={cx(
                    KEY_BASE,
                    'border-transparent bg-transparent text-plw-gold-soft shadow-none hover:bg-white/5'
                  )}
                >
                  <Delete size={24} aria-hidden="true" />
                </button>
              );
            }
            return (
              <button
                key={key}
                type="button"
                disabled={disabled || value.length >= PIN_LENGTH}
                onClick={() => onDigit(key)}
                aria-label={`Dígito ${key}`}
                className={cx(
                  KEY_BASE,
                  'border-white/10 bg-white/[0.06] text-plw-ink hover:border-plw-gold hover:bg-plw-gold/15 active:bg-plw-gold/25'
                )}
              >
                {key}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
