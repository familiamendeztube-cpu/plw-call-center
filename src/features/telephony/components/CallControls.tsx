import type { ReactNode } from 'react';
import { Mic, MicOff, Pause, Phone, PhoneForwarded, PhoneOff, Play } from 'lucide-react';
import { useTelephony } from '@/features/telephony/context/telephonyContext';
import { callButtons } from '@/features/telephony/models/call';
import { DIAL_REQUIRES_ACTIVE, useCanDial } from '@/features/presence/hooks/useCanDial';
import { cx } from '@/components/ui/cx';

interface SecondaryButtonProps {
  label: string;
  onClick: () => void;
  disabled: boolean;
  active?: boolean;
  children: ReactNode;
}

function SecondaryButton({
  label,
  onClick,
  disabled,
  active = false,
  children,
}: SecondaryButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cx(
        'flex h-14 flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plw-gold/60 disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'border-plw-gold bg-plw-gold text-white'
          : 'border-neutral-200 bg-white text-plw-navy hover:border-plw-gold'
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export function CallControls() {
  const {
    call,
    dialNumber,
    connectorStatus,
    placeCall,
    answerCall,
    hangUp,
    toggleMute,
    toggleHold,
    transferCall,
  } = useTelephony();
  const { live, incoming, canDial, canMute, canHold, canTransfer, onHold, muted } = callButtons(
    call,
    dialNumber,
    connectorStatus === 'registered'
  );
  const active = useCanDial();

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={incoming ? answerCall : placeCall}
          disabled={!incoming && (!canDial || !active)}
          title={!incoming && !active ? DIAL_REQUIRES_ACTIVE : undefined}
          className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-success-600 text-base font-semibold text-white shadow-sm transition-all hover:bg-success-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600 disabled:shadow-none"
        >
          <Phone size={20} aria-hidden="true" />
          {incoming ? 'Contestar' : 'Llamar'}
        </button>
        <button
          type="button"
          onClick={hangUp}
          disabled={!live}
          className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-danger-600 text-base font-semibold text-white shadow-sm transition-all hover:bg-danger-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600 disabled:shadow-none"
        >
          <PhoneOff size={20} aria-hidden="true" />
          {incoming ? 'Rechazar' : 'Colgar'}
        </button>
      </div>
      {!active && !live && !incoming ? (
        <p className="text-xs font-medium text-neutral-600">{DIAL_REQUIRES_ACTIVE}</p>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <SecondaryButton
          label={muted ? 'Reactivar' : 'Silenciar'}
          onClick={toggleMute}
          disabled={!canMute}
          active={muted}
        >
          {muted ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
        </SecondaryButton>
        <SecondaryButton
          label={onHold ? 'Reanudar' : 'En espera'}
          onClick={toggleHold}
          disabled={!canHold}
          active={onHold}
        >
          {onHold ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
        </SecondaryButton>
        <SecondaryButton label="Transferir" onClick={transferCall} disabled={!canTransfer}>
          <PhoneForwarded size={18} aria-hidden="true" />
        </SecondaryButton>
      </div>
    </div>
  );
}
