import { useTelephony } from '@/features/telephony/context/telephonyContext';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

export function InCallKeypad() {
  const { call, sendDtmf } = useTelephony();
  if (call?.state !== 'active') return null;

  return (
    <section aria-labelledby="in-call-keypad-title" className="flex flex-col gap-2">
      <h3
        id="in-call-keypad-title"
        className="text-xs font-semibold uppercase tracking-wider text-neutral-500"
      >
        Teclado de la llamada
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-label={`Enviar ${key}`}
            onClick={() => void sendDtmf(key)}
            className="h-12 rounded-xl border border-neutral-200 bg-white text-lg font-semibold text-plw-navy transition-all hover:border-plw-gold active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/60"
          >
            {key}
          </button>
        ))}
      </div>
    </section>
  );
}
