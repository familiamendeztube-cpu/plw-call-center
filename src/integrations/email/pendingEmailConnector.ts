import type { EmailConnector } from '@/integrations/email/emailContract';

export function createPendingEmailConnector(): EmailConnector {
  return {
    status: 'pending_configuration',
    sendMessage: async () => ({
      ok: false,
      message: 'El envío de correo está pendiente de configuración. El borrador se guardó.',
    }),
  };
}
