import { createHash, randomBytes } from 'node:crypto';

export const ENROLLMENT_CODE_BYTES = 12;

const NON_ALPHANUMERIC_PATTERN = /[^A-Za-z0-9]/g;

export function normalizeEnrollmentCode(input) {
  return input.replace(NON_ALPHANUMERIC_PATTERN, '').toUpperCase();
}

export function hashEnrollmentCode(input) {
  return createHash('sha256').update(normalizeEnrollmentCode(input), 'utf8').digest('hex');
}

export function formatEnrollmentCode(canonical) {
  return canonical.match(/.{1,4}/g).join('-');
}

export function generateEnrollmentCode(readBytes = randomBytes) {
  const bytes = readBytes(ENROLLMENT_CODE_BYTES);
  if (!bytes || bytes.length !== ENROLLMENT_CODE_BYTES) {
    throw new Error('No se pudo generar un código de registro seguro.');
  }
  const canonical = Buffer.from(bytes).toString('hex').toUpperCase();
  return {
    display: formatEnrollmentCode(canonical),
    canonical,
    hash: hashEnrollmentCode(canonical),
  };
}
