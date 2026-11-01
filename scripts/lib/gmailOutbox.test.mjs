import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRawGmailMessage,
  buildReplyMessage,
  encodeHeaderValue,
  foldHeader,
} from '../../supabase/functions/google-workspace/outbox/mimeMessage.js';
import {
  OutboxSendError,
  createGmailSender,
} from '../../supabase/functions/google-workspace/outbox/gmailSender.js';
import { processOutboxOnce } from '../../supabase/functions/google-workspace/outbox/outboxProcessor.js';

const DATE = new Date('2026-01-05T12:00:00Z');
const BASE_MESSAGE = {
  from: 'Plw@professionallatinoworker2026.com',
  to: 'cliente@example.com',
  subject: 'Re: Consulta de visa',
  body: 'Hola María,\nGracias por escribir. ¿Podemos hablar mañana?',
  messageId: '<abc@professionallatinoworker2026.com>',
  inReplyTo: '<parent@example.com>',
  references: '<root@example.com> <parent@example.com>',
  date: DATE,
};

function decodeRaw(raw) {
  const base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

function splitMessage(mime) {
  const index = mime.indexOf('\r\n\r\n');
  return { headers: mime.slice(0, index), body: mime.slice(index + 4) };
}

test('MIME headers carry threading data and UTF-8 declaration', () => {
  const { headers } = splitMessage(buildReplyMessage(BASE_MESSAGE));
  assert.match(headers, /^From: Plw@professionallatinoworker2026\.com/m);
  assert.match(headers, /^To: cliente@example\.com/m);
  assert.match(headers, /^In-Reply-To: <parent@example\.com>/m);
  assert.match(headers, /^References: <root@example\.com> <parent@example\.com>/m);
  assert.match(headers, /^Message-ID: <abc@professionallatinoworker2026\.com>/m);
  assert.match(headers, /^Content-Type: text\/plain; charset=UTF-8/m);
  assert.match(headers, /^Content-Transfer-Encoding: base64/m);
  assert.match(headers, /^Date: Mon, 05 Jan 2026 12:00:00 GMT/m);
});

test('non-ASCII subject is RFC 2047 encoded and decodes back exactly', () => {
  const subject = 'Re: Información sobre tu permiso de trabajo';
  const encoded = encodeHeaderValue(subject);
  assert.match(encoded, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  const payload = encoded.match(/=\?UTF-8\?B\?([^?]+)\?=/)[1];
  assert.equal(Buffer.from(payload, 'base64').toString('utf8'), 'Re: Información sobre tu permiso de trabajo');
});

test('subject encoding never splits a multi-byte character across words', () => {
  const subject = 'ñ'.repeat(60);
  const words = [...encodeHeaderValue(subject).matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
  const decoded = words.map((match) => Buffer.from(match[1], 'base64').toString('utf8')).join('');
  assert.equal(decoded, subject);
  assert.ok(words.length > 1);
});

test('body round-trips UTF-8 Spanish characters through base64', () => {
  const { body } = splitMessage(buildReplyMessage(BASE_MESSAGE));
  const decoded = Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.equal(decoded, 'Hola María,\r\nGracias por escribir. ¿Podemos hablar mañana?');
});

test('line breaks in header values cannot inject headers', () => {
  const { headers } = splitMessage(
    buildReplyMessage({ ...BASE_MESSAGE, to: 'a@example.com\r\nBcc: evil@example.com' })
  );
  assert.equal(/^Bcc:/m.test(headers), false);
});

test('long references are folded onto continuation lines under 78 characters', () => {
  const references = Array.from({ length: 12 }, (_, i) => `<m${i}@example.com>`).join(' ');
  const { headers } = splitMessage(buildReplyMessage({ ...BASE_MESSAGE, references }));
  const lines = headers.split('\r\n');
  assert.ok(lines.every((line) => line.length <= 78));
  assert.ok(lines.some((line) => line.startsWith(' <m')));
});

test('raw Gmail payload is URL-safe base64 of the full message', () => {
  const raw = buildRawGmailMessage(BASE_MESSAGE);
  assert.match(raw, /^[A-Za-z0-9_-]+$/);
  assert.match(decodeRaw(raw), /In-Reply-To: <parent@example\.com>/);
});

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(next.body ?? '{}', { status: next.status ?? 200 });
  };
  return { fetchImpl, calls };
}

test('sender posts raw message with threadId and returns Gmail ids', async () => {
  const { fetchImpl, calls } = fakeFetch([{ body: JSON.stringify({ id: 'g1', threadId: 't1' }) }]);
  const sender = createGmailSender({ fetchImpl, accessToken: 'tok' });
  const result = await sender.send({ raw: 'abc', threadId: 't1' });
  assert.deepEqual(result, { id: 'g1', threadId: 't1' });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0].init.body), { raw: 'abc', threadId: 't1' });
});

test('auth failure is a definitive rejection that never retries', async () => {
  const { fetchImpl } = fakeFetch([{ status: 401 }]);
  const sender = createGmailSender({ fetchImpl, accessToken: 'bad' });
  await assert.rejects(sender.send({ raw: 'x' }), (error) => error instanceof OutboxSendError && error.kind === 'rejected');
});

test('rate limiting is classified as retry and server errors as uncertain', async () => {
  const limited = createGmailSender({ fetchImpl: fakeFetch([{ status: 429 }]).fetchImpl, accessToken: 't' });
  await assert.rejects(limited.send({ raw: 'x' }), (error) => error.kind === 'retry');
  const broken = createGmailSender({ fetchImpl: fakeFetch([{ status: 503 }]).fetchImpl, accessToken: 't' });
  await assert.rejects(broken.send({ raw: 'x' }), (error) => error.kind === 'uncertain');
});

test('network timeout is uncertain, not rejected', async () => {
  const { fetchImpl } = fakeFetch([new Error('socket hang up')]);
  const sender = createGmailSender({ fetchImpl, accessToken: 't' });
  await assert.rejects(sender.send({ raw: 'x' }), (error) => error.kind === 'uncertain');
});

test('reconcile returns null when Gmail has no message with that Message-ID', async () => {
  const { fetchImpl, calls } = fakeFetch([{ body: '{}' }]);
  const sender = createGmailSender({ fetchImpl, accessToken: 't' });
  assert.equal(await sender.findSentByMessageId('<abc@x>'), null);
  assert.match(decodeURIComponent(calls[0].url), /rfc822msgid:<abc@x>/);
});

function makeStore(claimResult) {
  const settled = [];
  return {
    settled,
    store: {
      claim: async () => claimResult,
      settle: async (item, outcome, extra) => {
        settled.push({ id: item.id, outcome, ...extra });
        return true;
      },
    },
  };
}

function sendItem(overrides = {}) {
  return {
    action: 'send',
    id: 'o1',
    claimToken: 'tok',
    mailbox: 'Plw@professionallatinoworker2026.com',
    recipient: 'cliente@example.com',
    subject: 'Re: Consulta',
    body: 'Hola',
    rfcMessageId: '<m1@x>',
    threadId: 't1',
    inReplyTo: '<p@x>',
    references: '<p@x>',
    ...overrides,
  };
}

function sender(overrides = {}) {
  return {
    send: async () => ({ id: 'g1', threadId: 't1' }),
    findSentByMessageId: async () => null,
    ...overrides,
  };
}

const now = () => DATE;

test('processor sends once and settles Gmail-confirmed ids', async () => {
  const { store, settled } = makeStore(sendItem());
  let sent = 0;
  const result = await processOutboxOnce({
    store,
    now,
    sender: sender({ send: async (payload) => { sent += 1; assert.equal(payload.threadId, 't1'); return { id: 'g1', threadId: 't1' }; } }),
  });
  assert.equal(result, 'sent');
  assert.equal(sent, 1);
  assert.deepEqual(settled, [{ id: 'o1', outcome: 'sent', gmailMessageId: 'g1', gmailThreadId: 't1' }]);
});

test('idle queue returns without touching Gmail', async () => {
  const { store } = makeStore(null);
  let touched = false;
  const result = await processOutboxOnce({ store, now, sender: sender({ send: async () => { touched = true; } }) });
  assert.equal(result, 'idle');
  assert.equal(touched, false);
});

test('blocked claims never reach Gmail', async () => {
  const { store } = makeStore({ action: 'blocked', id: 'o1' });
  let touched = false;
  const result = await processOutboxOnce({ store, now, sender: sender({ send: async () => { touched = true; } }) });
  assert.equal(result, 'blocked');
  assert.equal(touched, false);
});

test('Gmail rejection settles as failed so the draft can be kept by the caller', async () => {
  const { store, settled } = makeStore(sendItem());
  const result = await processOutboxOnce({
    store,
    now,
    sender: sender({ send: async () => { throw new OutboxSendError('rejected', 400); } }),
  });
  assert.equal(result, 'failed');
  assert.equal(settled[0].outcome, 'failed');
  assert.ok(settled[0].error.length > 0);
});

test('rate limiting settles as retry, not as sent', async () => {
  const { store, settled } = makeStore(sendItem());
  const result = await processOutboxOnce({
    store,
    now,
    sender: sender({ send: async () => { throw new OutboxSendError('retry', 429); } }),
  });
  assert.equal(result, 'retry');
  assert.equal(settled[0].outcome, 'retry');
});

test('timeout after acceptance is uncertain and is never resent', async () => {
  const { store, settled } = makeStore(sendItem());
  let sendCalls = 0;
  const result = await processOutboxOnce({
    store,
    now,
    sender: sender({ send: async () => { sendCalls += 1; throw new OutboxSendError('uncertain'); } }),
  });
  assert.equal(result, 'uncertain');
  assert.equal(sendCalls, 1);
  assert.equal(settled[0].outcome, 'uncertain');
});

test('accept-then-timeout is reconciled by Message-ID instead of sending again', async () => {
  const { store, settled } = makeStore(sendItem({ action: 'reconcile' }));
  let sendCalls = 0;
  let searched = null;
  const result = await processOutboxOnce({
    store,
    now,
    sender: sender({
      send: async () => { sendCalls += 1; return { id: 'x', threadId: 'x' }; },
      findSentByMessageId: async (id) => { searched = id; return { id: 'g9', threadId: 't9' }; },
    }),
  });
  assert.equal(result, 'sent');
  assert.equal(sendCalls, 0);
  assert.equal(searched, '<m1@x>');
  assert.deepEqual(settled[0], { id: 'o1', outcome: 'sent', gmailMessageId: 'g9', gmailThreadId: 't9' });
});

test('reconcile that finds nothing stays uncertain and never resends', async () => {
  const { store, settled } = makeStore(sendItem({ action: 'reconcile' }));
  let sendCalls = 0;
  const result = await processOutboxOnce({
    store,
    now,
    sender: sender({ send: async () => { sendCalls += 1; }, findSentByMessageId: async () => null }),
  });
  assert.equal(result, 'uncertain');
  assert.equal(sendCalls, 0);
  assert.equal(settled[0].outcome, 'uncertain');
});

test('reconcile errors are treated as unknown, not as proof of rejection', async () => {
  const { store, settled } = makeStore(sendItem({ action: 'reconcile' }));
  const result = await processOutboxOnce({
    store,
    now,
    sender: sender({ findSentByMessageId: async () => { throw new OutboxSendError('uncertain', 500); } }),
  });
  assert.equal(result, 'uncertain');
  assert.equal(settled[0].outcome, 'uncertain');
});

function olderImportItem() {
  return sendItem({ inReplyTo: null, references: '', sourceGmailMessageId: 'src1', threadId: 't1' });
}

function headerStore(claimResult, setHeadersResult = true) {
  const base = makeStore(claimResult);
  const headerCalls = [];
  base.store.setHeaders = async (item, source) => {
    headerCalls.push({ id: item.id, source });
    return setHeadersResult;
  };
  return { ...base, headerCalls };
}

test('older import fetches the source Message-ID and sends a threaded reply', async () => {
  const { store, headerCalls, settled } = headerStore(olderImportItem());
  let rawSent = '';
  const result = await processOutboxOnce({
    store,
    now,
    sender: sender({
      readSourceHeaders: async (id) => {
        assert.equal(id, 'src1');
        return { messageId: '<src@example.com>', references: '<root@example.com>' };
      },
      send: async ({ raw }) => { rawSent = raw; return { id: 'g2', threadId: 't1' }; },
    }),
  });
  assert.equal(result, 'sent');
  assert.deepEqual(headerCalls, [{ id: 'o1', source: { messageId: '<src@example.com>', references: '<root@example.com>' } }]);
  const mime = Buffer.from(rawSent.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.match(mime, /In-Reply-To: <src@example\.com>/);
  assert.match(mime, /References: <root@example\.com> <src@example\.com>/);
  assert.equal(settled[0].outcome, 'sent');
});

test('failed source header lookup retries without sending', async () => {
  const { store, settled } = headerStore(olderImportItem());
  let sendCalls = 0;
  const result = await processOutboxOnce({
    store,
    now,
    sender: sender({
      readSourceHeaders: async () => { throw new OutboxSendError('uncertain', 500); },
      send: async () => { sendCalls += 1; return { id: 'x', threadId: 'x' }; },
    }),
  });
  assert.equal(result, 'retry');
  assert.equal(sendCalls, 0);
  assert.equal(settled[0].outcome, 'retry');
});

test('a source Message-ID that is not a valid header value is ignored', async () => {
  const { store, headerCalls } = headerStore(olderImportItem());
  let rawSent = '';
  await processOutboxOnce({
    store,
    now,
    sender: sender({
      readSourceHeaders: async () => ({ messageId: 'no-brackets', references: '' }),
      send: async ({ raw }) => { rawSent = raw; return { id: 'g3', threadId: 't1' }; },
    }),
  });
  assert.equal(headerCalls.length, 0);
  const mime = Buffer.from(rawSent.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.equal(/In-Reply-To:/.test(mime), false);
});

test('a worker that lost its claim while saving headers never sends', async () => {
  const { store } = headerStore(olderImportItem(), false);
  let sendCalls = 0;
  const result = await processOutboxOnce({
    store,
    now,
    sender: sender({
      readSourceHeaders: async () => ({ messageId: '<src@example.com>', references: '' }),
      send: async () => { sendCalls += 1; return { id: 'x', threadId: 'x' }; },
    }),
  });
  assert.equal(result, 'stale');
  assert.equal(sendCalls, 0);
});
