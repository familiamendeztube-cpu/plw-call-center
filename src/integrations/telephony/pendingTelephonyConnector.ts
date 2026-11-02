import type { TelephonyConnector } from '@/integrations/telephony/telephonyContract';

const PENDING_RESULT = { ok: false, message: 'Telefonía pendiente de configuración' };

export function createPendingTelephonyConnector(): TelephonyConnector {
  return {
    status: 'pending_configuration',
    subscribe: () => () => undefined,
    start: async () => undefined,
    stop: () => undefined,
    dial: async () => PENDING_RESULT,
    answer: async () => PENDING_RESULT,
    hangup: async () => PENDING_RESULT,
    setMuted: async () => PENDING_RESULT,
    setOnHold: async () => PENDING_RESULT,
    transfer: async () => PENDING_RESULT,
  };
}
