import type { TelephonyConnectorStatus } from '@/integrations/telephony/telephonyContract';

export const CONNECTOR_STATUS_LABELS: Record<TelephonyConnectorStatus, string> = {
  pending_configuration: 'Pendiente de configuración',
  connecting: 'Conectando',
  registered: 'Registrado',
  error: 'Error de conexión',
};
