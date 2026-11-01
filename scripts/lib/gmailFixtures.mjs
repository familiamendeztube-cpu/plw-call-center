export const MAILBOX = 'plw@professionallatinoworker2026.com';
export const IMPORT_FROM = '2026-10-01T00:00:00.000Z';

export function header(name, value) {
  return { name, value };
}

export function makeMessage(id, overrides = {}) {
  const {
    threadId = `thread-${id}`,
    labelIds = ['INBOX'],
    from = 'Ana Pérez <ana@negocio.com>',
    headers = [],
    text = `Hola ${id}`,
  } = overrides;
  return {
    id,
    threadId,
    labelIds,
    internalDate: String(Date.parse('2026-10-15T12:00:00.000Z')),
    payload: {
      mimeType: 'multipart/alternative',
      headers: [header('From', from), header('Subject', `Asunto ${id}`), ...headers],
      parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(text).toString('base64url') } }],
    },
  };
}
