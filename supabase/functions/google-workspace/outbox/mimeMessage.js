const MAX_ENCODED_WORD_BYTES = 45;
const MAX_HEADER_LINE = 76;

export function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function utf8Base64(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

function wrapBase64(base64) {
  return base64.match(/.{1,76}/g)?.join('\r\n') ?? '';
}

function stripLineBreaks(value) {
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

function encodedWordChunks(text) {
  const chunks = [];
  let current = '';
  let currentBytes = 0;
  for (const char of text) {
    const bytes = new TextEncoder().encode(char).length;
    if (currentBytes + bytes > MAX_ENCODED_WORD_BYTES) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function encodeHeaderValue(value) {
  const clean = stripLineBreaks(value);
  if (!/[^\x20-\x7e]/.test(clean)) return clean;
  return encodedWordChunks(clean)
    .map((chunk) => `=?UTF-8?B?${utf8Base64(chunk)}?=`)
    .join(' ');
}

export function foldHeader(name, value) {
  const line = `${name}: ${value}`;
  if (line.length <= MAX_HEADER_LINE) return line;
  const lines = [];
  let current = `${name}:`;
  for (const part of value.split(' ')) {
    if (current.length + 1 + part.length > MAX_HEADER_LINE && current !== `${name}:`) {
      lines.push(current);
      current = ` ${part}`;
    } else {
      current += ` ${part}`;
    }
  }
  lines.push(current);
  return lines.join('\r\n');
}

export function toBase64Url(text) {
  return utf8Base64(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function buildReplyMessage({
  from,
  to,
  subject,
  body,
  messageId,
  inReplyTo = null,
  references = '',
  date,
}) {
  const headers = [
    foldHeader('From', stripLineBreaks(from)),
    foldHeader('To', stripLineBreaks(to)),
    `Subject: ${encodeHeaderValue(subject)}`,
    `Date: ${date.toUTCString()}`,
    foldHeader('Message-ID', stripLineBreaks(messageId)),
  ];
  if (inReplyTo) headers.push(foldHeader('In-Reply-To', stripLineBreaks(inReplyTo)));
  if (references) headers.push(foldHeader('References', stripLineBreaks(references)));
  headers.push(
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  );
  const normalizedBody = String(body).replace(/\r?\n/g, '\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${wrapBase64(utf8Base64(normalizedBody))}\r\n`;
}

export function buildRawGmailMessage(input) {
  return toBase64Url(buildReplyMessage(input));
}
