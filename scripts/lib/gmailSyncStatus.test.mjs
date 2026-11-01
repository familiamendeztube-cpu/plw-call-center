import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  gmailSyncLabel,
  gmailSyncState,
  parseGmailSyncStatus,
} from '../../src/features/admin/models/gmailSync.ts';

const base = {
  isRunning: true,
  importFrom: '2026-01-01T00:00:00.000Z',
  phase: 'listing',
  leaseActive: false,
  lastSuccessAt: null,
  lastError: null,
  lastErrorAt: null,
  consecutiveFailures: 0,
  connected: true,
  connectedAccount: 'plw@professionallatinoworker2026.com',
};

test('a disconnected mailbox is reported as disconnected whatever else is set', () => {
  assert.equal(gmailSyncState({ ...base, connected: false, isRunning: true }), 'disconnected');
  assert.equal(gmailSyncLabel({ ...base, connected: false }), 'Sin conectar');
});

test('repeated failures show an error even while the sync is marked running', () => {
  const status = { ...base, consecutiveFailures: 2, lastError: 'Gmail no responde', leaseActive: true };
  assert.equal(gmailSyncState(status), 'error');
});

test('a stopped sync is paused and never shown as running', () => {
  assert.equal(gmailSyncState({ ...base, isRunning: false, leaseActive: true }), 'paused');
});

test('a worker holding the lease is importing', () => {
  assert.equal(gmailSyncState({ ...base, leaseActive: true }), 'importing');
  assert.equal(gmailSyncLabel({ ...base, leaseActive: true }), 'Importando correos');
});

test('a running sync between passes is waiting, not importing', () => {
  assert.equal(gmailSyncState({ ...base, leaseActive: false, phase: 'listing' }), 'waiting');
});

test('success is shown only once a backend checkpoint has recorded a success', () => {
  const incremental = { ...base, phase: 'incremental', leaseActive: false };
  assert.equal(gmailSyncState({ ...incremental, lastSuccessAt: null }), 'waiting');
  assert.equal(
    gmailSyncState({ ...incremental, lastSuccessAt: '2026-02-01T10:00:00.000Z' }),
    'synced'
  );
});

test('a status without the active-lease flag is rejected instead of guessed', () => {
  const withoutLease = { ...base };
  delete withoutLease.leaseActive;
  assert.equal(parseGmailSyncStatus(withoutLease), null);
  assert.equal(parseGmailSyncStatus(base)?.leaseActive, false);
});
