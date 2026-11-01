const IV_BYTES = 12;

function base64ToBytes(base64) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function importKey(secret) {
  const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptRefreshToken(plaintext, secret) {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  const combined = new Uint8Array(IV_BYTES + encrypted.length);
  combined.set(iv, 0);
  combined.set(encrypted, IV_BYTES);
  return bytesToBase64(combined);
}

export async function decryptRefreshToken(ciphertext, secret) {
  const key = await importKey(secret);
  const combined = base64ToBytes(ciphertext);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: combined.slice(0, IV_BYTES) },
    key,
    combined.slice(IV_BYTES),
  );
  return new TextDecoder().decode(decrypted);
}
