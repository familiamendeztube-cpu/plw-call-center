import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { CALL_STATE_LABELS, isCallLive } from '@/features/telephony/models/call';
import { CallTimer } from '@/features/telephony/components/CallTimer';

export function PhoneScreen() {
  const { call, dialNumber } = useTelephony();
  const displayNumber = call?.remoteNumber ?? dialNumber;
  const state = call?.state ?? 'idle';

  return (
    <div className="rounded-2xl bg-plw-deep px-5 py-5 text-white shadow-inner">
      <div className="flex items-center justify-between text-xs text-white/60">
        <span>{CALL_STATE_LABELS[state]}</span>
        <CallTimer startedAt={call?.startedAt ?? null} running={call?.state === 'active'} />
      </div>
      <p
        className="mt-3 min-h-[2.25rem] truncate text-center font-light tabular-nums text-3xl tracking-wide"
        aria-live="polite"
        aria-label="Número marcado"
      >
        {displayNumber || <span className="text-white/30">Introduce un número</span>}
      </p>
      <p className="mt-1 h-4 text-center text-xs text-plw-gold-soft">
        {call && isCallLive(call.state) && call.direction === 'outbound' ? 'Llamada saliente' : ''}
      </p>
    </div>
  );
}
