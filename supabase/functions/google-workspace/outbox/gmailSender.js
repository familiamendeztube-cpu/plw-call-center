const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SEND_TIMEOUT_MS = 25000;
const READ_TIMEOUT_MS = 15000;

export class OutboxSendError extends Error {
  constructor(kind, status = 0) {
    super(kind);
    this.name = 'OutboxSendError';
    this.kind = kind;
    this.status = status;
  }
}

function classifyStatus(status) {
  if (status === 429) return 'retry';
  if (status >= 400 && status < 500 && status !== 408) return 'rejected';
  return 'uncertain';
}

async function call(fetchImpl, accessToken, url, init, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new OutboxSendError('uncertain', 0);
  }
  if (!response.ok) throw new OutboxSendError(classifyStatus(response.status), response.status);
  try {
    return await response.json();
  } catch {
    throw new OutboxSendError('uncertain', response.status);
  }
}

function headerValue(message, name) {
  const headers = message?.payload?.headers ?? [];
  const match = headers.find((header) => header.name?.toLowerCase() === name.toLowerCase());
  return typeof match?.value === 'string' ? match.value.trim() : '';
}

export function createGmailSender({ fetchImpl, accessToken }) {
  return {
    async send({ raw, threadId }) {
      const data = await call(
        fetchImpl,
        accessToken,
        `${GMAIL_BASE}/messages/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
        },
        SEND_TIMEOUT_MS
      );
      if (typeof data?.id !== 'string' || data.id === '') throw new OutboxSendError('uncertain');
      return { id: data.id, threadId: typeof data.threadId === 'string' ? data.threadId : '' };
    },

    async findSentByMessageId(rfcMessageId) {
      const url = new URL(`${GMAIL_BASE}/messages`);
      url.searchParams.set('q', `rfc822msgid:${rfcMessageId}`);
      url.searchParams.set('includeSpamTrash', 'true');
      url.searchParams.set('maxResults', '2');
      const data = await call(fetchImpl, accessToken, url.toString(), {}, READ_TIMEOUT_MS);
      const first = Array.isArray(data?.messages) ? data.messages[0] : undefined;
      if (!first || typeof first.id !== 'string') return null;
      return { id: first.id, threadId: typeof first.threadId === 'string' ? first.threadId : '' };
    },

    async readSourceHeaders(gmailMessageId) {
      const url = new URL(`${GMAIL_BASE}/messages/${encodeURIComponent(gmailMessageId)}`);
      url.searchParams.set('format', 'metadata');
      url.searchParams.append('metadataHeaders', 'Message-ID');
      url.searchParams.append('metadataHeaders', 'References');
      const data = await call(fetchImpl, accessToken, url.toString(), {}, READ_TIMEOUT_MS);
      return {
        messageId: headerValue(data, 'Message-ID'),
        references: headerValue(data, 'References'),
      };
    },
  };
}
