import type {
  DraftSaveResult,
  OutboxItem,
  OutboxStatus,
  ReplyTarget,
  SendRequestResult,
} from '@/features/inbox/models/reply';
import { OUTBOX_STATUS_LABELS } from '@/features/inbox/models/reply';
import { readNullableString, readString } from '@/production/adapters/productionRows';

const OUTBOX_STATUSES = Object.keys(OUTBOX_STATUS_LABELS) as OutboxStatus[];

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid-reply-payload');
  }
  return value as Record<string, unknown>;
}

function readStatus(row: Record<string, unknown>): OutboxStatus {
  const status = readString(row, 'status');
  if (!OUTBOX_STATUSES.includes(status as OutboxStatus)) throw new Error('invalid-reply-payload');
  return status as OutboxStatus;
}

export function toOutboxItem(row: Record<string, unknown>): OutboxItem {
  return {
    id: readString(row, 'id'),
    messageId: readString(row, 'message_id'),
    status: readStatus(row),
    lastError: readString(row, 'last_error'),
    sentAt: readNullableString(row, 'sent_at'),
  };
}

export function parseReplyTarget(data: unknown): ReplyTarget {
  const row = asRecord(data);
  if (row.ok === true) {
    return {
      ok: true,
      recipient: readString(row, 'recipient'),
      subject: readString(row, 'subject'),
    };
  }
  return {
    ok: false,
    reason: row.reason === 'sin_correo' ? 'sin_correo' : 'destinatario_no_confirmado',
  };
}

export function parseDraftSave(data: unknown): DraftSaveResult {
  const row = asRecord(data);
  if (typeof row.applied !== 'boolean' || typeof row.revision !== 'number') {
    throw new Error('invalid-reply-payload');
  }
  return {
    applied: row.applied,
    revision: row.revision,
    body: readString(row, 'body'),
    updatedAt: readString(row, 'updatedAt'),
  };
}

export function parseSendRequest(data: unknown): SendRequestResult {
  const row = asRecord(data);
  return {
    outboxId: readString(row, 'outboxId'),
    messageId: readString(row, 'messageId'),
    status: readStatus({ status: row.status }),
  };
}
