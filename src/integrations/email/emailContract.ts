import type { ConnectorResult } from '@/integrations/connectorResult';

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
}

export interface EmailConnector {
  readonly status: 'pending_configuration';
  sendMessage(message: OutgoingEmail): Promise<ConnectorResult>;
}
