import type { ReactNode } from 'react';
import {
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneForwarded,
  PhoneOff,
  Play,
  Smartphone,
} from 'lucide-react';
import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { CALL_STATE_LABELS, callButtons } from '@/features/telephony/models/call';
import { CallTimer } from '@/features/telephony/components/CallTimer';
import { ConnectionStatus } from '@/features/telephony/components/ConnectionStatus';
import { DialInput } from '@/features/telephony/components/PhoneScreen';
import { cx } from '@/components/ui/cx';

const MAIN_BUTTON =
  'flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/60 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600';

interface IconButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}

function IconButton({ label, onClick, disabled = false, pressed, children }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/60 disabled:cursor-not-allowed disabled:opacity-40',
        pressed
          ? 'border-plw-gold bg-plw-gold text-white'
          : 'border-neutral-200 bg-white text-plw-navy hover:border-plw-gold'
      )}
    >
      {children}
    </button>
  );
}

interface PhoneBarProps {
  /** Opens the full phone: availability, customer actions, recent calls, audio. */
  onOpenPhone: () => void;
}

/** The dialer that stays on screen when the window is too narrow for the full phone. */
export function PhoneBar({ onOpenPhone }: PhoneBarProps) {
  const {
    call,
    dialNumber,
    connectorStatus,
    commandError,
    placeCall,
    answerCall,
    hangUp,
    toggleMute,
    toggleHold,
    transferCall,
  } = useTelephony();
  const can = callButtons(call, dialNumber, connectorStatus === 'registered');

  return (
    <section
      aria-label="Marcador"
      className={cx(
        'border-b border-neutral-200 px-4 py-2 shadow-sm sm:px-6 lg:px-8',
        can.incoming ? 'bg-plw-gold-soft' : 'bg-white'
      )}
    >
      {/* When the buttons don't fit beside the number, they wrap below it instead of crushing it. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[13rem] flex-1 items-center gap-3">
          <ConnectionStatus status={connectorStatus} labelClassName="sr-only lg:not-sr-only" />
          <label className="flex h-11 min-w-0 flex-1 cursor-text items-center gap-3 rounded-xl bg-plw-deep px-3 text-white focus-within:ring-2 focus-within:ring-plw-gold">
            <span className="flex shrink-0 flex-col text-[11px] leading-tight text-white/60">
              <span>{CALL_STATE_LABELS[call?.state ?? 'idle']}</span>
              <CallTimer startedAt={call?.startedAt ?? null} running={call?.state === 'active'} />
            </span>
            <DialInput className="h-full min-w-0 flex-1 text-lg placeholder:text-sm placeholder:text-white/40" />
          </label>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={can.incoming ? answerCall : placeCall}
            disabled={!can.incoming && !can.canDial}
            className={cx(MAIN_BUTTON, 'bg-success-600 hover:bg-success-700')}
          >
            <Phone size={18} aria-hidden="true" />
            <span className="sr-only md:not-sr-only">{can.incoming ? 'Contestar' : 'Llamar'}</span>
          </button>
          <button
            type="button"
            onClick={hangUp}
            disabled={!can.live}
            className={cx(MAIN_BUTTON, 'bg-danger-600 hover:bg-danger-700')}
          >
            <PhoneOff size={18} aria-hidden="true" />
            <span className="sr-only md:not-sr-only">{can.incoming ? 'Rechazar' : 'Colgar'}</span>
          </button>
          {/* Only useful once someone is on the line, so they don't take room before that. */}
          {can.canHold ? (
            <>
              <IconButton
                label={can.muted ? 'Reactivar' : 'Silenciar'}
                onClick={toggleMute}
                disabled={!can.canMute}
                pressed={can.muted}
              >
                {can.muted ? (
                  <MicOff size={18} aria-hidden="true" />
                ) : (
                  <Mic size={18} aria-hidden="true" />
                )}
              </IconButton>
              <IconButton
                label={can.onHold ? 'Reanudar' : 'En espera'}
                onClick={toggleHold}
                pressed={can.onHold}
              >
                {can.onHold ? (
                  <Play size={18} aria-hidden="true" />
                ) : (
                  <Pause size={18} aria-hidden="true" />
                )}
              </IconButton>
              <IconButton label="Transferir" onClick={transferCall} disabled={!can.canTransfer}>
                <PhoneForwarded size={18} aria-hidden="true" />
              </IconButton>
            </>
          ) : null}
          <IconButton label="Abrir el teléfono completo" onClick={onOpenPhone}>
            <Smartphone size={18} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      {commandError ? (
        <p role="alert" className="mt-1.5 text-xs font-medium text-danger-700">
          {commandError}
        </p>
      ) : null}
    </section>
  );
}
