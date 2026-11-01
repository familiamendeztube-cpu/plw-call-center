import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGmailMessage } from '../../supabase/functions/google-workspace/sync/gmailParser.js';

const MAILBOX = 'plw@professionallatinoworker2026.com';
const BODY = Buffer.from('Hola, quiero información.').toString('base64url');

function makeMessage(headers) {
  return {
    id: 'gm1',
    threadId: 'thr1',
    internalDate: String(Date.parse('2026-01-05T12:00:00Z')),
    labelIds: ['INBOX'],
    payload: {
      mimeType: 'text/plain',
      headers: headers.map(([name, value]) => ({ name, value })),
      body: { data: BODY },
    },
  };
}

test('direct mail keeps its Message-ID and references for replies', () => {
  const result = parseGmailMessage(
    makeMessage([
      ['From', 'Ana <ana@example.com>'],
      ['Subject', 'Consulta'],
      ['Message-ID', '<abc123@mail.example.com>'],
      ['References', '<root@mail.example.com> <prev@mail.example.com>'],
    ]),
    MAILBOX
  );
  assert.equal(result.record.rfcMessageId, '<abc123@mail.example.com>');
  assert.equal(result.record.references, '<root@mail.example.com> <prev@mail.example.com>');
  assert.equal(result.record.viaNotification, false);
});

test('a malformed Message-ID is stored as null instead of a raw header', () => {
  const result = parseGmailMessage(
    makeMessage([
      ['From', 'Ana <ana@example.com>'],
      ['Message-ID', 'abc123 without brackets'],
    ]),
    MAILBOX
  );
  assert.equal(result.record.rfcMessageId, null);
});

test('trusted form mail is flagged as coming through a notification', () => {
  const result = parseGmailMessage(
    makeMessage([
      ['From', 'Formularios <forms@website.example.com>'],
      ['Subject', 'Nuevo contacto'],
      ['Auto-Submitted', 'auto-generated'],
      ['Reply-To', 'cliente@example.com'],
      ['Message-ID', '<form-1@website.example.com>'],
    ]),
    MAILBOX,
    { trustedSenders: new Set(['forms@website.example.com']) }
  );
  assert.equal(result.record.viaNotification, true);
  assert.equal(result.record.rfcMessageId, '<form-1@website.example.com>');
});
