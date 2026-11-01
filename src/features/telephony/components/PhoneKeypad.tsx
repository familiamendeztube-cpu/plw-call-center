import { Delete } from 'lucide-react';
import { useTelephony } from '@/features/telephony/context/telephonyContext';

const KEYS: { digit: string; letters: string }[] = [
  { digit: '1', letters: '' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: '' },
  { digit: '0', letters: '+' },
  { digit: '#', letters: '' },
];

export function PhoneKeypad() {
  const { appendDigit, deleteDigit, dialNumber } = useTelephony();

  return (
    <div className="mx-auto grid w-full max-w-[240px] grid-cols-3 gap-x-4 gap-y-3">
      {KEYS.map(({ digit, letters }) => (
        <button
          key={digit}
          type="button"
          aria-label={`Tecla ${digit}`}
          onClick={() => appendDigit(digit)}
          className="group flex aspect-square flex-col items-center justify-center rounded-full bg-neutral-100 text-plw-ink transition-all duration-150 hover:bg-neutral-200 active:scale-95 active:bg-plw-gold-soft/40"
        >
          <span className="text-xl font-medium leading-none">{digit}</span>
          <span className="mt-0.5 h-2.5 text-[9px] font-medium tracking-[0.15em] text-neutral-500">
            {letters}
          </span>
        </button>
      ))}
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <button
        type="button"
        aria-label="Borrar último dígito"
        disabled={dialNumber.length === 0}
        onClick={deleteDigit}
        className="flex aspect-square items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 disabled:opacity-30"
      >
        <Delete size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
