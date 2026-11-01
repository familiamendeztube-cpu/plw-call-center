import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  ENROLLMENT_CODE_BYTES,
  formatEnrollmentCode,
  generateEnrollmentCode,
  hashEnrollmentCode,
  normalizeEnrollmentCode,
} from './enrollmentCode.mjs';

const sha256Hex = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

test('normalization strips separators and uppercases like the database function', () => {
  assert.equal(normalizeEnrollmentCode('0123-4567-89ab-cdef-0123-4567'), '0123456789ABCDEF01234567');
  assert.equal(normalizeEnrollmentCode(' ab cd-ef_12 '), 'ABCDEF12');
  assert.equal(normalizeEnrollmentCode('---'), '');
});

test('hash is sha256 of the canonical uppercase code', () => {
  const canonical = '0123456789ABCDEF01234567';
  assert.equal(hashEnrollmentCode(canonical), sha256Hex(canonical));
  assert.equal(hashEnrollmentCode('0123-4567-89ab-cdef-0123-4567'), sha256Hex(canonical));
  assert.equal(hashEnrollmentCode('0123 4567 89AB CDEF 0123 4567'), sha256Hex(canonical));
});

test('hash matches a fixed vector shared with the database function', () => {
  const expected = '571ae701ea6d1910c55d521b0a758422dbebfb107b168ef39bc15249736f1ec9';
  assert.equal(hashEnrollmentCode('FFFFEEEE-DDDDCCCC-BBBBAAAA'), expected);
  assert.equal(hashEnrollmentCode('ffffeeeedddd-ccccbbbbaaaa'), expected);
});

test('generated code is 24 uppercase hex characters grouped for display', () => {
  const code = generateEnrollmentCode();
  assert.equal(code.canonical.length, 24);
  assert.match(code.canonical, /^[0-9A-F]{24}$/);
  assert.equal(code.display, formatEnrollmentCode(code.canonical));
  assert.match(code.display, /^[0-9A-F]{4}(-[0-9A-F]{4}){5}$/);
  assert.equal(code.hash, sha256Hex(code.canonical));
  assert.equal(hashEnrollmentCode(code.display), code.hash);
});

test('generator uses exactly the configured number of random bytes', () => {
  let requested = null;
  generateEnrollmentCode((size) => {
    requested = size;
    return randomBytes(size);
  });
  assert.equal(requested, ENROLLMENT_CODE_BYTES);
  assert.equal(ENROLLMENT_CODE_BYTES, 12);
});

test('generator rejects a short or missing random source', () => {
  assert.throws(() => generateEnrollmentCode(() => Buffer.alloc(11)), /No se pudo generar/);
  assert.throws(() => generateEnrollmentCode(() => null), /No se pudo generar/);
});

test('byte values at the top of the range never produce an undefined character', () => {
  const allTopBytes = generateEnrollmentCode(() => Buffer.alloc(12, 0xff));
  assert.equal(allTopBytes.canonical, 'F'.repeat(24));
  const index31Byte = generateEnrollmentCode(() => Buffer.alloc(12, 31));
  assert.equal(index31Byte.canonical, '1F'.repeat(12));
  assert.ok(!/undefined/.test(index31Byte.display));
});
