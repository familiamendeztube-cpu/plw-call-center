import { GoogleApiError } from '../googleApi.js';
import { parseGmailMessage } from './gmailParser.js';

export const SYNC_BUDGET_MS = 90_000;
export const MAX_CURSOR_RESTARTS = 2;

const AUTH_FAILURE_MESSAGE = 'La autorización de Google no es válida. Vuelva a conectar la cuenta.';
const TRANSIENT_FAILURE_MESSAGE =
  'No se pudo sincronizar el correo. Se reintentará automáticamente.';

class StaleRunError extends Error {}

export function buildInboxQuery(importFrom) {
  const seconds = Math.floor(Date.parse(importFrom) / 1000);
  return `after:${seconds} -in:sent -in:drafts -in:spam -in:trash`;
}

export function describeSyncError(error) {
  const authFailure =
    error instanceof GoogleApiError && [400, 401, 403].includes(error.status);
  return authFailure ? AUTH_FAILURE_MESSAGE : TRANSIENT_FAILURE_MESSAGE;
}

export async function runGmailSync({
  store,
  createGmail,
  mailbox,
  now = Date.now,
  budgetMs = SYNC_BUDGET_MS,
}) {
  const claim = await store.claim();
  if (!claim) return { status: 'idle', counts: emptyCounts() };

  const run = {
    store,
    mailbox,
    now,
    claim,
    token: claim.runToken,
    version: claim.connectionVersion,
    deadline: now() + budgetMs,
    counts: emptyCounts(),
    gmail: null,
    trustedSenders: new Set(),
  };
  const cursor = {
    phase: claim.phase,
    pageToken: claim.pageToken,
    historyId: claim.historyId,
    pending: claim.pending,
    targetHistoryId: claim.targetHistoryId,
    restarts: 0,
  };

  try {
    run.gmail = await createGmail();
    run.trustedSenders = await store.loadTrustedSenders();
    const status = await runPhases(run, cursor);
    return { status, counts: run.counts };
  } catch (error) {
    if (error instanceof StaleRunError) return { status: 'stale', counts: run.counts };
    const message = describeSyncError(error);
    await store.checkpoint({
      ...cursorFields(run, cursor),
      release: true,
      error: message,
      success: false,
    });
    return { status: 'failed', message, counts: run.counts };
  }
}

async function runPhases(run, cursor) {
  for (;;) {
    if (cursor.phase === 'listing') {
      const result = await listAllMessages(run, cursor);
      if (result !== 'done') return result;
      continue;
    }
    const result = await applyHistory(run, cursor);
    if (result !== 'expired') return result;
    if (cursor.restarts >= MAX_CURSOR_RESTARTS) throw new Error('cursor-restart-limit');
    cursor.restarts += 1;
    cursor.phase = 'listing';
    cursor.pageToken = null;
    cursor.historyId = null;
    cursor.pending = null;
    cursor.targetHistoryId = null;
    await save(run, cursor);
  }
}

async function listAllMessages(run, cursor) {
  if (cursor.historyId === null) {
    cursor.historyId = await run.gmail.profileHistoryId();
    await save(run, cursor);
  }

  const query = buildInboxQuery(run.claim.importFrom);
  for (;;) {
    if (cursor.pending === null) {
      const page = await run.gmail.listMessages({ query, pageToken: cursor.pageToken });
      cursor.pending = page.ids;
      cursor.pageToken = page.nextPageToken;
      await save(run, cursor);
    }
    if ((await drainPending(run, cursor)) === 'partial') return 'partial';
    if (cursor.pageToken === null) break;
    cursor.pending = null;
  }

  cursor.phase = 'incremental';
  cursor.pending = null;
  await save(run, cursor);
  return 'done';
}

async function applyHistory(run, cursor) {
  if (cursor.historyId === null) return 'expired';
  const startHistoryId = cursor.historyId;

  for (;;) {
    if (cursor.pending === null) {
      let page;
      try {
        page = await run.gmail.listHistory({ startHistoryId, pageToken: cursor.pageToken });
      } catch (error) {
        if (error instanceof GoogleApiError && error.status === 404) return 'expired';
        throw error;
      }
      cursor.pending = page.ids;
      cursor.pageToken = page.nextPageToken;
      cursor.targetHistoryId = page.historyId ?? cursor.targetHistoryId ?? startHistoryId;
      await save(run, cursor);
    }
    if ((await drainPending(run, cursor)) === 'partial') return 'partial';
    if (cursor.pageToken === null) break;
    cursor.pending = null;
  }

  cursor.historyId = cursor.targetHistoryId ?? startHistoryId;
  cursor.targetHistoryId = null;
  cursor.pending = null;
  cursor.pageToken = null;
  await save(run, cursor, { release: true, success: true });
  return 'synced';
}

async function drainPending(run, cursor) {
  while (cursor.pending.length > 0) {
    if (await pauseForBudget(run, cursor)) return 'partial';
    await importMessage(run, cursor.pending[0]);
    cursor.pending = cursor.pending.slice(1);
    await save(run, cursor);
  }
  return 'drained';
}

async function pauseForBudget(run, cursor) {
  if (run.now() < run.deadline) return false;
  await save(run, cursor, { release: true });
  return true;
}

async function importMessage(run, id) {
  let message;
  try {
    message = await run.gmail.getMessage(id);
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) {
      run.counts.skipped += 1;
      return;
    }
    throw error;
  }

  const parsed = parseGmailMessage(message, run.mailbox, { trustedSenders: run.trustedSenders });
  if (parsed.skip) {
    run.counts.skipped += 1;
    return;
  }
  const result = await run.store.recordMessage({
    version: run.version,
    runToken: run.token,
    message: parsed.record,
  });
  if (result.outcome === 'stale') throw new StaleRunError();
  run.counts[result.outcome] += 1;
}

function cursorFields(run, cursor) {
  return {
    version: run.version,
    runToken: run.token,
    phase: cursor.phase,
    pageToken: cursor.pageToken,
    historyId: cursor.historyId,
    pending: cursor.pending,
    targetHistoryId: cursor.targetHistoryId,
  };
}

async function save(run, cursor, overrides = {}) {
  const saved = await run.store.checkpoint({
    ...cursorFields(run, cursor),
    release: false,
    error: null,
    success: false,
    ...overrides,
  });
  if (!saved) throw new StaleRunError();
}

function emptyCounts() {
  return { created: 0, reply: 0, duplicate: 0, skipped: 0 };
}
