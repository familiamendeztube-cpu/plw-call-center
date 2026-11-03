import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { CALL_STATE_LABELS, isCallLive } from '@/features/telephony/models/call';
import { CallTimer } from '@/features/telephony/components/CallTimer';

export function PhoneScreen() {
  const { call, dialNumber, changeDialNumber, placeCall } = useTelephony();
  const live = call !== null && isCallLive(call.state);
  const state = call?.state ?? 'idle';

  return (
    <label className="block cursor-text rounded-2xl bg-plw-deep px-5 py-5 text-white shadow-inner focus-within:ring-2 focus-within:ring-plw-gold">
      <span className="flex items-center justify-between text-xs text-white/60">
        <span>{CALL_STATE_LABELS[state]}</span>
        <CallTimer startedAt={call?.startedAt ?? null} running={call?.state === 'active'} />
      </span>
      <input
        type="tel"
        aria-label="Número marcado"
        autoComplete="off"
        placeholder="Introduce un número"
        readOnly={live}
        value={live ? call.remoteNumber : dialNumber}
        onChange={(event) => changeDialNumber(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !live && dialNumber) void placeCall();
        }}
        className="mt-3 h-9 w-full truncate bg-transparent text-center text-3xl font-light tabular-nums tracking-wide placeholder:text-lg placeholder:text-white/30 focus-visible:ring-0 focus-visible:ring-offset-0"
      />
      <span aria-live="polite" className="mt-1 block h-4 text-center text-xs text-plw-gold-soft">
        {live ? (call.direction === 'outbound' ? 'Llamada saliente' : 'Llamada entrante') : ''}
      </span>
    </label>
  );
}
