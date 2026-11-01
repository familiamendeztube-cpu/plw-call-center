import { buildRawGmailMessage } from './mimeMessage.js';
import { OutboxSendError } from './gmailSender.js';

const LEASE_SECONDS = 120;
const MAX_REFERENCES_CHARS = 4000;
const MESSAGE_ID_PATTERN = /^<[^<>\s]{1,250}>$/;

const REJECTION_MESSAGE = 'Gmail no aceptó el mensaje. Revisa la dirección e inténtalo de nuevo.';
const RETRY_MESSAGE = 'Gmail está ocupado. Se reintentará automáticamente.';
const PREPARE_MESSAGE = 'No pudimos preparar el mensaje. Se reintentará automáticamente.';
const UNCERTAIN_MESSAGE = 'No pudimos confirmar el envío. Se verificará en Gmail antes de reintentar.';
const NOT_CONFIRMED_MESSAGE = 'Gmail aún no confirma el envío. Se seguirá verificando sin reenviar.';

function sendFailureOutcome(error) {
  if (!(error instanceof OutboxSendError)) return { outcome: 'uncertain', message: UNCERTAIN_MESSAGE };
  if (error.kind === 'rejected') return { outcome: 'failed', message: REJECTION_MESSAGE };
  if (error.kind === 'retry') return { outcome: 'retry', message: RETRY_MESSAGE };
  return { outcome: 'uncertain', message: UNCERTAIN_MESSAGE };
}

function joinReferences(existing, messageId) {
  return [existing, messageId].filter(Boolean).join(' ').slice(0, MAX_REFERENCES_CHARS);
}

function usableMessageId(value) {
  return typeof value === 'string' && MESSAGE_ID_PATTERN.test(value) ? value : '';
}

async function withSourceHeaders(item, deps) {
  if (item.inReplyTo || !item.sourceGmailMessageId) return item;
  const source = await deps.sender.readSourceHeaders(item.sourceGmailMessageId);
  const messageId = usableMessageId(source.messageId);
  if (!messageId) return item;
  const references = typeof source.references === 'string' ? source.references : '';
  const saved = await deps.store.setHeaders(item, { messageId, references });
  if (!saved) return null;
  return { ...item, inReplyTo: messageId, references: joinReferences(references, messageId) };
}

async function reconcileItem(item, deps) {
  let found = null;
  try {
    found = await deps.sender.findSentByMessageId(item.rfcMessageId);
  } catch {
    found = null;
  }
  if (!found) {
    await deps.store.settle(item, 'uncertain', { error: NOT_CONFIRMED_MESSAGE });
    return 'uncertain';
  }
  await deps.store.settle(item, 'sent', { gmailMessageId: found.id, gmailThreadId: found.threadId });
  return 'sent';
}

async function prepareMessage(claimed, deps) {
  try {
    const item = await withSourceHeaders(claimed, deps);
    if (!item) return { stale: true };
    return { item, raw: buildRawGmailMessage({
      from: item.mailbox,
      to: item.recipient,
      subject: item.subject,
      body: item.body,
      messageId: item.rfcMessageId,
      inReplyTo: item.inReplyTo || null,
      references: item.references || '',
      date: deps.now(),
    }) };
  } catch {
    return { error: PREPARE_MESSAGE };
  }
}

async function sendItem(claimed, deps) {
  const prepared = await prepareMessage(claimed, deps);
  if (prepared.stale) return 'stale';
  if (prepared.error) {
    await deps.store.settle(claimed, 'retry', { error: prepared.error });
    return 'retry';
  }

  let accepted;
  try {
    accepted = await deps.sender.send({ raw: prepared.raw, threadId: prepared.item.threadId || undefined });
  } catch (error) {
    const { outcome, message } = sendFailureOutcome(error);
    await deps.store.settle(prepared.item, outcome, { error: message });
    return outcome;
  }
  await deps.store.settle(prepared.item, 'sent', {
    gmailMessageId: accepted.id,
    gmailThreadId: accepted.threadId,
  });
  return 'sent';
}

export async function processOutboxOnce(deps) {
  const item = await deps.store.claim(LEASE_SECONDS);
  if (!item) return 'idle';
  if (item.action === 'blocked') return 'blocked';
  if (item.action === 'reconcile') return reconcileItem(item, deps);
  return sendItem(item, deps);
}
