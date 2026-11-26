import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { CALL_STATE_LABELS, isCallLive, originLabel } from '@/features/telephony/models/call';
import { CallTimer } from '@/features/telephony/components/CallTimer';
import { useCanDial } from '@/features/presence/hooks/useCanDial';
import { cx } from '@/components/ui/cx';

/** The number being dialed. Enter calls it; during a call it shows who is on the line. */
export function DialInput({ className }: { className: string }) {
  const { call, dialNumber, changeDialNumber, placeCall } = useTelephony();
  const live = call !== null && isCallLive(call.state);
  const active = useCanDial();

  return (
    <input
      type="tel"
      aria-label="Número marcado"
      autoComplete="off"
      placeholder="Introduce un número"
      readOnly={live}
      value={live ? call.remoteNumber : dialNumber}
      onChange={(event) => changeDialNumber(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !live && dialNumber && active) void placeCall();
      }}
      className={cx(
        'truncate bg-transparent tabular-nums focus-visible:ring-0 focus-visible:ring-offset-0',
        className
      )}
    />
  );
}

/** "EE. UU." or "Costa Rica" for the number on the line, so the agent knows before answering. */
export function CallerOriginTag({ number }: { number: string }) {
  const label = originLabel(number);
  return label ? (
    <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-plw-gold-soft">
      {label}
    </span>
  ) : null;
}

export function PhoneScreen() {
  const { call } = useTelephony();
  const live = call !== null && isCallLive(call.state);
  const state = call?.state ?? 'idle';
  const origin = live ? originLabel(call.remoteNumber) : '';

  return (
    <label className="block cursor-text rounded-2xl bg-plw-deep px-5 py-5 text-white shadow-inner focus-within:ring-2 focus-within:ring-plw-gold">
      <span className="flex items-center justify-between text-xs text-white/60">
        <span>{CALL_STATE_LABELS[state]}</span>
        <CallTimer startedAt={call?.startedAt ?? null} running={call?.state === 'active'} />
      </span>
      <DialInput className="mt-3 h-9 w-full text-center text-3xl font-light tracking-wide placeholder:text-lg placeholder:text-white/50" />
      <span aria-live="polite" className="mt-1 block h-4 text-center text-xs text-plw-gold-soft">
        {live
          ? `${call.direction === 'outbound' ? 'Llamada saliente' : 'Llamada entrante'}${origin ? ` · ${origin}` : ''}`
          : ''}
      </span>
    </label>
  );
}
