const MAX_AGE_SECONDS = 30 * 60; // Same window as the ElevenLabs webhook: a backed-up queue still lands.
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

function hexBytes(hex) {
  return Uint8Array.from(hex.match(/../g), (pair) => parseInt(pair, 16));
}

/**
 * X-Chatwoot-Signature: sha256=<hex HMAC-SHA256 of "<X-Chatwoot-Timestamp>.<raw body>">.
 * crypto.subtle.verify compares in constant time.
 */
export async function verifySignature(signature, timestamp, rawBody, secret, nowSeconds = Date.now() / 1000) {
  if (typeof signature !== 'string' || typeof timestamp !== 'string') return false;
  if (typeof secret !== 'string' || secret === '') return false;
  const hex = /^sha256=([0-9a-f]{64})$/.exec(signature)?.[1];
  if (!hex || !/^[0-9]{1,12}$/.test(timestamp)) return false;
  const age = nowSeconds - Number(timestamp);
  if (age > MAX_AGE_SECONDS || age < -MAX_CLOCK_SKEW_SECONDS) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify('HMAC', key, hexBytes(hex), encoder.encode(`${timestamp}.${rawBody}`));
}

function text(value, max) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}

/**
 * Only a customer's own message in the WhatsApp inbox matters to PLW. Agent replies, bot greetings,
 * private notes and activity lines are ignored, so none of them can clear or fake the unread mark.
 */
export function messageFromEvent(event, inboxId) {
  if (typeof event !== 'object' || event === null) return { invalid: 'malformed' };
  if (event.event !== 'message_created') return { ignore: 'event' };
  if (event.private === true) return { ignore: 'private' };
  if (event.message_type !== 'incoming') return { ignore: 'not_incoming' };
  const conversation = event.conversation;
  const inbox = conversation?.inbox_id ?? event.inbox?.id;
  if (String(inbox) !== String(inboxId)) return { ignore: 'other_inbox' };
  // Webhooks send the conversation's display id, the one the API paths use.
  const conversationId = conversation?.id;
  if (!Number.isInteger(conversationId) || conversationId <= 0 || conversationId > 2147483647) {
    return { invalid: 'no_conversation' };
  }
  const contact = event.sender?.type === 'contact' ? event.sender : conversation?.meta?.sender;
  const phone = text(contact?.phone_number, 40);
  if (!phone) return { invalid: 'no_phone' };
  return { chat: { conversationId, phone, name: text(contact?.name, 120) ?? '' } };
}

const MB = 1024 * 1024;
// What WhatsApp Cloud accepts, with WhatsApp's own size limits. Documents may be up to 100 MB in
// WhatsApp, but each file passes through the function's memory.
// ponytail: documents capped at 16 MB; send bigger ones from Chatwoot, or upload straight to storage if needed.
const MEDIA = {
  jpg: ['image/jpeg', 5],
  jpeg: ['image/jpeg', 5],
  png: ['image/png', 5],
  mp4: ['video/mp4', 16],
  '3gp': ['video/3gpp', 16],
  mp3: ['audio/mpeg', 16],
  m4a: ['audio/mp4', 16],
  aac: ['audio/aac', 16],
  amr: ['audio/amr', 16],
  ogg: ['audio/ogg', 16],
  pdf: ['application/pdf', 16],
  txt: ['text/plain', 16],
  doc: ['application/msword', 16],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 16],
  xls: ['application/vnd.ms-excel', 16],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 16],
  ppt: ['application/vnd.ms-powerpoint', 16],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 16],
};
export const MAX_UPLOAD_BYTES = 16 * MB;
export const MAX_CAPTION = 1024; // WhatsApp's limit for the text sent with a file.

/**
 * The type to send a file as, or why WhatsApp would refuse it. Decided by the extension: browsers on
 * Windows often leave the type of Office files empty.
 */
export function whatsAppFile(name, size) {
  const extension = String(name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const media = MEDIA[extension];
  if (!media) {
    return {
      error:
        'WhatsApp no acepta ese tipo de archivo. Envía una foto (JPG o PNG), un video MP4, un audio o un documento (PDF, Word, Excel o PowerPoint).',
    };
  }
  const [type, limitMb] = media;
  if (!Number.isFinite(size) || size <= 0) return { error: 'El archivo está vacío.' };
  if (size > limitMb * MB) {
    return { error: `Ese archivo pesa más de ${limitMb} MB, el máximo de WhatsApp para este tipo.` };
  }
  return { type };
}

export const CONNECT_ERRORS = {
  invalid: 'Ese token de Chatwoot no es válido. Cópialo de nuevo desde tu perfil.',
  other_account: 'Ese usuario de Chatwoot no pertenece a la cuenta de PLW.',
  not_agent:
    'Conecta tu propio usuario de agente. Un token de administrador haría que respondieras con el nombre del administrador.',
  no_inbox: 'Tu usuario de Chatwoot no tiene acceso a la bandeja de WhatsApp. Pide que te agreguen.',
};

/**
 * Who a pasted token belongs to, from Chatwoot's own answers (GET /profile and the inboxes that user
 * can see). Accepted only for an agent of this account who can see the WhatsApp inbox. The profile
 * also carries the token itself, so only these fields are kept.
 */
export function chatwootIdentity(profile, inboxes, accountId, inboxId) {
  const userId = profile?.id;
  if (!Number.isInteger(userId) || userId <= 0 || userId > 2147483647) return { error: 'invalid' };
  const membership = (Array.isArray(profile.accounts) ? profile.accounts : []).find(
    (account) => String(account?.id) === String(accountId)
  );
  if (!membership) return { error: 'other_account' };
  if (membership.role !== 'agent') return { error: 'not_agent' };
  const visible = Array.isArray(inboxes?.payload) ? inboxes.payload : [];
  if (!visible.some((inbox) => String(inbox?.id) === String(inboxId))) return { error: 'no_inbox' };
  return {
    identity: {
      userId,
      name: text(profile.name, 120) ?? text(profile.available_name, 120) ?? `Usuario ${userId}`,
      email: text(profile.email, 254) ?? '',
    },
  };
}

// {{1}} in positional templates, {{customer_name}} in named ones.
const VARIABLE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function variables(text) {
  return [...new Set([...String(text ?? '').matchAll(VARIABLE)].map((match) => match[1]))];
}

/**
 * The approved templates an agent can send by filling in the blanks of the body. Templates that
 * also need a header picture or values in the header or buttons are left to Chatwoot.
 */
export function sendableTemplates(list) {
  if (!Array.isArray(list)) return [];
  return list.flatMap((template) => {
    if (String(template?.status ?? '').toUpperCase() !== 'APPROVED') return [];
    if (typeof template.name !== 'string' || typeof template.language !== 'string') return [];
    const components = Array.isArray(template.components) ? template.components : [];
    const body = components.find((part) => part?.type === 'BODY');
    if (typeof body?.text !== 'string') return [];
    const needsMore = components.some(
      (part) =>
        (part?.type === 'HEADER' && ((part.format ?? 'TEXT') !== 'TEXT' || variables(part.text).length > 0)) ||
        (part?.type === 'BUTTONS' &&
          (Array.isArray(part.buttons) ? part.buttons : []).some(
            (button) => button?.type === 'COPY_CODE' || variables(button?.url).length > 0
          ))
    );
    if (needsMore) return [];
    return [{
      name: template.name,
      language: template.language,
      category: String(template.category ?? 'UTILITY'),
      body: body.text,
      params: variables(body.text),
    }];
  });
}

/**
 * The Chatwoot message for a template with every blank filled, or null when one is missing.
 * WhatsApp refuses values with line breaks, so whitespace is collapsed.
 */
export function renderTemplate(template, values) {
  const filled = {};
  for (const param of template.params) {
    const value = typeof values?.[param] === 'string' ? values[param].replace(/\s+/g, ' ').trim() : '';
    if (!value || value.length > 1024) return null;
    filled[param] = value;
  }
  return {
    content: template.body.replace(VARIABLE, (_, name) => filled[name]),
    message_type: 'outgoing',
    private: false,
    template_params: {
      name: template.name,
      category: template.category,
      language: template.language,
      processed_params: { body: filled },
    },
  };
}

/**
 * One Chatwoot message as the agent sees it, or null for what is not part of the chat.
 * The list API numbers message_type (0 incoming, 1 outgoing, 2 activity, 3 template).
 */
export function chatMessage(message) {
  if (typeof message !== 'object' || message === null || message.private === true) return null;
  const type = message.message_type;
  if (![0, 1, 3].includes(type)) return null;
  const attachments = (Array.isArray(message.attachments) ? message.attachments : [])
    .filter((file) => typeof file?.data_url === 'string' && /^https?:\/\//.test(file.data_url))
    .map((file) => ({ kind: String(file.file_type ?? 'file'), url: file.data_url }));
  const body = typeof message.content === 'string' ? message.content.trim() : '';
  if (!body && attachments.length === 0) return null;
  return {
    id: String(message.id),
    author: type === 0 ? 'customer' : 'agent',
    body,
    sentAt: new Date(Number(message.created_at) * 1000).toISOString(),
    failed: message.status === 'failed',
    attachments,
  };
}
