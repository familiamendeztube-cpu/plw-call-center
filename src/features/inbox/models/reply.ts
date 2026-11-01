export type OutboxStatus = 'queued' | 'sending' | 'confirming' | 'sent' | 'failed';

export const OUTBOX_STATUS_LABELS: Record<OutboxStatus, string> = {
  queued: 'En cola',
  sending: 'Enviando',
  confirming: 'Confirmando envío',
  sent: 'Enviado',
  failed: 'No se pudo enviar',
};

export const OUTBOX_PENDING_STATUSES: readonly OutboxStatus[] = ['queued', 'sending', 'confirming'];

export interface OutboxItem {
  id: string;
  messageId: string;
  status: OutboxStatus;
  lastError: string;
  sentAt: string | null;
}

export type ReplyTarget =
  | { ok: true; recipient: string; subject: string }
  | { ok: false; reason: 'sin_correo' | 'destinatario_no_confirmado' };

export interface DraftSaveResult {
  applied: boolean;
  revision: number;
  body: string;
  updatedAt: string;
}

export interface SendRequestResult {
  outboxId: string;
  messageId: string;
  status: OutboxStatus;
}
