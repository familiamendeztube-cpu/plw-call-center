import type { CallSnapshot } from '@/features/telephony/models/call';
import type { ConnectorResult } from '@/integrations/connectorResult';

export type TelephonyConnectorStatus =
  'pending_configuration' | 'connecting' | 'registered' | 'error';

export type TelephonyConnectorEvent =
  | { type: 'status'; status: TelephonyConnectorStatus }
  | { type: 'call'; call: CallSnapshot | null };

export interface TelephonyConnector {
  readonly status: TelephonyConnectorStatus;
  subscribe(listener: (event: TelephonyConnectorEvent) => void): () => void;
  dial(number: string): Promise<ConnectorResult>;
  hangup(): Promise<ConnectorResult>;
  setMuted(muted: boolean): Promise<ConnectorResult>;
  setOnHold(onHold: boolean): Promise<ConnectorResult>;
  transfer(number: string): Promise<ConnectorResult>;
}
