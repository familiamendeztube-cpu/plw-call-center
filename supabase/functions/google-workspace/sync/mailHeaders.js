const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const ENCODED_WORD = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;

export function headerMap(headers = []) {
  const map = {};
  for (const header of headers) {
    if (header && typeof header.name === 'string') {
      map[header.name.toLowerCase()] = typeof header.value === 'string' ? header.value : '';
    }
  }
  return map;
}

export function parseAddress(headerValue) {
  const value = String(headerValue ?? '').trim();
  const bracketed = /<([^<>]+)>/.exec(value);
  const address = (bracketed ? bracketed[1] : value).trim().toLowerCase();
  return EMAIL_PATTERN.test(address) ? address : '';
}

export function parseDisplayName(headerValue) {
  const value = decodeEncodedWords(String(headerValue ?? '').trim());
  const bracketIndex = value.indexOf('<');
  const name = bracketIndex >= 0 ? value.slice(0, bracketIndex) : '';
  return name.trim().replace(/^"|"$/g, '').trim();
}

export function decodeEncodedWords(text) {
  return text.replace(ENCODED_WORD, (_match, charset, encoding, payload) => {
    try {
      const bytes =
        encoding.toUpperCase() === 'B'
          ? base64ToBytes(payload)
          : quotedPrintableToBytes(payload);
      return new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch {
      return payload;
    }
  });
}

export function base64ToBytes(base64) {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function quotedPrintableToBytes(text) {
  const bytes = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '_') {
      bytes.push(0x20);
    } else if (char === '=' && /^[0-9A-F]{2}$/i.test(text.slice(index + 1, index + 3))) {
      bytes.push(parseInt(text.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(char.charCodeAt(0));
    }
  }
  return Uint8Array.from(bytes);
}
