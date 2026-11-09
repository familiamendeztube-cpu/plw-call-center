import { cx } from '@/components/ui/cx';
import type { TelephonyConnectorStatus } from '@/integrations/telephony/telephonyContract';

interface ConnectionStatusProps {
  status: TelephonyConnectorStatus;
  /** Lets a cramped layout keep only the dot on screen (the label stays for screen readers). */
  labelClassName?: string;
}

const STATUS_DISPLAY: Record<
  TelephonyConnectorStatus,
  { label: string; dot: string; text: string }
> = {
  pending_configuration: {
    label: 'Telefonía pendiente de configuración',
    dot: 'bg-neutral-400',
    text: 'text-neutral-600',
  },
  connecting: { label: 'Conectando línea', dot: 'bg-warning-600', text: 'text-warning-700' },
  registered: { label: 'Línea registrada', dot: 'bg-success-500', text: 'text-success-700' },
  error: { label: 'Error de conexión', dot: 'bg-danger-600', text: 'text-danger-700' },
};

export function ConnectionStatus({ status, labelClassName }: ConnectionStatusProps) {
  const display = STATUS_DISPLAY[status];
  return (
    <span
      title={display.label}
      className={cx('inline-flex shrink-0 items-center gap-2 text-xs font-medium', display.text)}
    >
      <span aria-hidden="true" className={cx('h-2 w-2 rounded-full', display.dot)} />
      <span className={labelClassName}>{display.label}</span>
    </span>
  );
}
