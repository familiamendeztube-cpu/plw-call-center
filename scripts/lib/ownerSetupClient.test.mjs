import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { printEnrollmentCode, requireEnv } from './ownerSetupClient.mjs';

function captureConsole(run) {
  const lines = [];
  const spy = mock.method(console, 'log', (line) => lines.push(String(line)));
  try {
    run();
  } finally {
    spy.mock.restore();
  }
  return lines;
}

test('printing shows the code, local expiry time, 15 minutes and single-use note', () => {
  const expiresAt = '2030-01-15T10:15:00.000Z';
  const lines = captureConsole(() => printEnrollmentCode('ABCD-1234-EF56', expiresAt));
  const joined = lines.join('\n');
  assert.match(joined, /ABCD-1234-EF56/);
  assert.match(joined, /15 minutos/);
  assert.match(joined, /Solo puede usarse una vez/);
  assert.match(joined, /Guárdelo/);
  const local = new Date(expiresAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  assert.match(joined, new RegExp(`Vence a las ${local.replace(/[.:]/g, '\\$&')}`));
});

test('printing refuses an invalid expiry instead of showing a code', () => {
  let logged = false;
  const spy = mock.method(console, 'log', () => {
    logged = true;
  });
  try {
    assert.throws(() => printEnrollmentCode('ABCD-1234-EF56', 'not-a-date'), /vigencia válida/);
    assert.throws(() => printEnrollmentCode('ABCD-1234-EF56', undefined), /vigencia válida/);
  } finally {
    spy.mock.restore();
  }
  assert.equal(logged, false);
});

test('requireEnv reports a missing variable without echoing values', () => {
  const previous = process.env.PLW_TEST_MISSING_VAR;
  delete process.env.PLW_TEST_MISSING_VAR;
  try {
    assert.throws(() => requireEnv('PLW_TEST_MISSING_VAR'), /PLW_TEST_MISSING_VAR/);
  } finally {
    if (previous !== undefined) process.env.PLW_TEST_MISSING_VAR = previous;
  }
});
