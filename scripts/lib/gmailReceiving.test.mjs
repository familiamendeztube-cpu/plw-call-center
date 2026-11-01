import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGmailClient } from '../../supabase/functions/google-workspace/sync/gmailClient.js';
import { cleanBody } from '../../supabase/functions/google-workspace/sync/gmailParser.js';
import {
  buildInboxQuery,
  runGmailSync,
} from '../../supabase/functions/google-workspace/sync/syncEngine.js';
import { GoogleApiError } from '../../supabase/functions/google-workspace/googleApi.js';
import { IMPORT_FROM, MAILBOX, header, makeMessage } from './gmailFixtures.mjs';

const fiveMessages = ['m1', 'm2', 'm3', 'm4', 'm5'].map((id) => makeMessage(id));

function fakeGmail({
  messages,
  pageSize = 2,
  historyPages = [],
  historyId = 'h-100',
  expiredHistoryCalls = 0,
  missing = [],
  clock = null,
  costMs = 0,
}) {
  const calls = { profile: 0, list: [], history: [], fetched: [] };
  let expiredLeft = expiredHistoryCalls;
  return {
    calls,
    async profileHistoryId() {
      calls.profile += 1;
      return historyId;
    },
    async listMessages({ pageToken }) {
      calls.list.push(pageToken ?? null);
      const start = pageToken ? Number(pageToken) : 0;
      const ids = messages.slice(start, start + pageSize).map((item) => item.id);
      const next = start + pageSize < messages.length ? String(start + pageSize) : null;
      return { ids, nextPageToken: next };
    },
    async listHistory({ startHistoryId, pageToken }) {
      calls.history.push({ startHistoryId, pageToken: pageToken ?? null });
      if (expiredLeft > 0) {
        expiredLeft -= 1;
        throw new GoogleApiError('notFound', 404);
      }
      const index = pageToken ? Number(pageToken) : 0;
      const page = historyPages[index] ?? { ids: [] };
      const next = index + 1 < historyPages.length ? String(index + 1) : null;
      return { ids: page.ids, nextPageToken: next, historyId: 'h-latest' };
    },
    async getMessage(id) {
      calls.fetched.push(id);
      if (clock) clock.now += costMs;
      const found = messages.find((item) => item.id === id);
      if (!found || missing.includes(id)) throw new GoogleApiError('notFound', 404);
      return found;
    },
  };
}

// Mirrors the database rules: a write is accepted only with the live run token,
// an unexpired lease, a connected mailbox, and the current connection version.
function fakeDb({ trustedSenders = [] } = {}) {
  let tokenCount = 0;
  const db = {
    records: new Map(),
    checkpoints: [],
    afterRecord: null,
    trustedSenders,
    state: {
      running: true,
      connected: true,
      version: 3,
      leaseLive: false,
      runToken: null,
      phase: 'listing',
      pageToken: null,
      historyId: null,
      pending: null,
      targetHistoryId: null,
    },
    isCurrent(version, token) {
      const s = db.state;
      return (
        token !== null &&
        token === s.runToken &&
        s.leaseLive &&
        s.running &&
        s.connected &&
        version === s.version
      );
    },
    pause() {
      db.state.running = false;
      db.state.runToken = null;
      db.state.leaseLive = false;
    },
    resume() {
      db.state.running = true;
    },
    disconnect() {
      db.state.connected = false;
      db.state.runToken = null;
      db.state.leaseLive = false;
    },
    expireLease() {
      db.state.leaseLive = false;
    },
    store: {
      async claim() {
        const s = db.state;
        if (!s.running || !s.connected || s.leaseLive) return null;
        tokenCount += 1;
        s.runToken = `run-${tokenCount}`;
        s.leaseLive = true;
        return {
          runToken: s.runToken,
          connectionVersion: s.version,
          phase: s.phase,
          pageToken: s.pageToken,
          historyId: s.historyId,
          pending: s.pending,
          targetHistoryId: s.targetHistoryId,
          importFrom: IMPORT_FROM,
        };
      },
      async checkpoint(input) {
        const accepted = db.isCurrent(input.version, input.runToken);
        db.checkpoints.push({ ...input, accepted });
        if (!accepted) return false;
        const s = db.state;
        Object.assign(s, {
          phase: input.phase,
          pageToken: input.pageToken,
          historyId: input.historyId,
          pending: input.pending,
          targetHistoryId: input.targetHistoryId,
        });
        if (input.release) {
          s.leaseLive = false;
          s.runToken = null;
        }
        return true;
      },
      async recordMessage({ version, runToken, message }) {
        if (!db.isCurrent(version, runToken)) return { outcome: 'stale' };
        if (db.records.has(message.gmailMessageId)) return { outcome: 'duplicate' };
        const outcome = [...db.records.values()].some(
          (item) => item.gmailThreadId === message.gmailThreadId,
        )
          ? 'reply'
          : 'created';
        db.records.set(message.gmailMessageId, { ...message, outcome });
        if (db.afterRecord) await db.afterRecord(db);
        return { outcome };
      },
      async loadTrustedSenders() {
        return new Set(db.trustedSenders);
      },
    },
  };
  return db;
}

function budgetedClock() {
  const clock = { now: 0 };
  return { clock, now: () => clock.now };
}

test('paginated listing imports every message and records the history snapshot', async () => {
  const gmail = fakeGmail({ messages: fiveMessages, pageSize: 2 });
  const db = fakeDb();
  const result = await runGmailSync({ store: db.store, createGmail: async () => gmail, mailbox: MAILBOX });

  assert.equal(result.status, 'synced');
  assert.equal(result.counts.created, 5);
  assert.equal(gmail.calls.profile, 1);
  assert.deepEqual(gmail.calls.list, [null, '2', '4']);
  assert.equal(db.state.historyId, 'h-latest');
  assert.equal(db.state.leaseLive, false);
});

test('budgeted runs make progress on every pass until all five messages are processed', async () => {
  const { clock, now } = budgetedClock();
  const gmail = fakeGmail({ messages: fiveMessages, pageSize: 2, clock, costMs: 60 });
  const db = fakeDb();
  const statuses = [];
  const created = [];
  for (let pass = 0; pass < 10; pass++) {
    const result = await runGmailSync({
      store: db.store,
      createGmail: async () => gmail,
      mailbox: MAILBOX,
      now,
      budgetMs: 90,
    });
    statuses.push(result.status);
    created.push(result.counts.created);
    if (result.status !== 'partial') break;
  }

  assert.deepEqual(statuses, ['partial', 'partial', 'synced']);
  assert.deepEqual(created, [2, 2, 1]);
  assert.deepEqual(gmail.calls.fetched, ['m1', 'm2', 'm3', 'm4', 'm5'], 'no message is fetched twice');
  assert.equal(db.records.size, 5);
});

test('a deleted or non-inbox message is skipped without blocking the rest of the page', async () => {
  const { clock, now } = budgetedClock();
  const messages = [
    makeMessage('m1'),
    makeMessage('gone'),
    makeMessage('sent1', { labelIds: ['SENT'] }),
    makeMessage('m2'),
    makeMessage('m3'),
  ];
  const gmail = fakeGmail({ messages, pageSize: 5, missing: ['gone'], clock, costMs: 30 });
  const db = fakeDb();
  const statuses = [];
  let skipped = 0;
  for (let pass = 0; pass < 10; pass++) {
    const result = await runGmailSync({
      store: db.store,
      createGmail: async () => gmail,
      mailbox: MAILBOX,
      now,
      budgetMs: 60,
    });
    statuses.push(result.status);
    skipped += result.counts.skipped;
    if (result.status !== 'partial') break;
  }

  assert.deepEqual(statuses, ['partial', 'partial', 'synced']);
  assert.equal(skipped, 2);
  assert.deepEqual([...db.records.keys()].sort(), ['m1', 'm2', 'm3']);
});

test('expired history cursor restarts the listing from the import date', async () => {
  const gmail = fakeGmail({ messages: fiveMessages.slice(0, 2), expiredHistoryCalls: 1 });
  const db = fakeDb();
  db.state.phase = 'incremental';
  db.state.historyId = 'h-old';
  const result = await runGmailSync({ store: db.store, createGmail: async () => gmail, mailbox: MAILBOX });

  assert.equal(result.status, 'synced');
  assert.equal(gmail.calls.history.length, 2);
  assert.equal(gmail.calls.profile, 1, 'fresh snapshot taken after expiry');
  assert.equal(result.counts.created, 2);
  assert.equal(db.state.historyId, 'h-latest');
});

test('a cursor that keeps expiring gives up after the restart limit', async () => {
  const gmail = fakeGmail({ messages: fiveMessages.slice(0, 2), expiredHistoryCalls: 99 });
  const db = fakeDb();
  db.state.phase = 'incremental';
  db.state.historyId = 'h-old';
  const result = await runGmailSync({ store: db.store, createGmail: async () => gmail, mailbox: MAILBOX });

  assert.equal(result.status, 'failed');
  assert.equal(gmail.calls.profile, 2);
  assert.equal(db.state.leaseLive, false);
});

test('incremental history imports new inbox messages and advances the cursor', async () => {
  const extra = makeMessage('n1');
  const gmail = fakeGmail({
    messages: [...fiveMessages, extra],
    historyPages: [{ ids: ['n1'] }],
  });
  const db = fakeDb();
  db.state.phase = 'incremental';
  db.state.historyId = 'h-50';
  const result = await runGmailSync({ store: db.store, createGmail: async () => gmail, mailbox: MAILBOX });

  assert.equal(result.status, 'synced');
  assert.equal(result.counts.created, 1);
  assert.equal(db.state.historyId, 'h-latest');
  assert.equal(gmail.calls.history[0].startHistoryId, 'h-50');
});

test('pausing mid-import makes the in-flight run stale and resumes without duplicates', async () => {
  const gmail = fakeGmail({ messages: fiveMessages, pageSize: 5 });
  const db = fakeDb();
  let paused = false;
  db.afterRecord = (state) => {
    if (paused) return;
    paused = true;
    state.pause();
  };
  const first = await runGmailSync({ store: db.store, createGmail: async () => gmail, mailbox: MAILBOX });
  assert.equal(first.status, 'stale');
  assert.equal(first.counts.created, 1);

  db.resume();
  db.afterRecord = null;
  const second = await runGmailSync({ store: db.store, createGmail: async () => gmail, mailbox: MAILBOX });
  assert.equal(second.status, 'synced');
  assert.equal(second.counts.duplicate, 1, 'the message recorded before the pause is recognized');
  assert.equal(second.counts.created, 4);
  assert.equal(db.records.size, 5);
});

test('a takeover by a newer run makes the older run stale and the newer run finishes the import', async () => {
  const gmail = fakeGmail({ messages: fiveMessages, pageSize: 5 });
  const db = fakeDb();
  let taken = false;
  let newer = null;
  db.afterRecord = async (state) => {
    if (taken) return;
    taken = true;
    state.expireLease();
    newer = await runGmailSync({ store: state.store, createGmail: async () => gmail, mailbox: MAILBOX });
  };
  const older = await runGmailSync({ store: db.store, createGmail: async () => gmail, mailbox: MAILBOX });

  assert.equal(older.status, 'stale');
  assert.equal(older.counts.created, 1);
  assert.equal(newer.status, 'synced');
  assert.equal(newer.counts.duplicate, 1);
  assert.equal(db.records.size, 5);
  assert.ok(db.checkpoints.some((item) => item.accepted === false));
});

test('disconnecting Google while an import waits stops the run and blocks later writes', async () => {
  const { clock, now } = budgetedClock();
  const gmail = fakeGmail({ messages: fiveMessages, pageSize: 5, clock, costMs: 60 });
  const db = fakeDb();
  const first = await runGmailSync({
    store: db.store,
    createGmail: async () => gmail,
    mailbox: MAILBOX,
    now,
    budgetMs: 90,
  });
  assert.equal(first.status, 'partial');

  db.disconnect();
  const second = await runGmailSync({
    store: db.store,
    createGmail: async () => gmail,
    mailbox: MAILBOX,
    now,
    budgetMs: 90,
  });
  assert.equal(second.status, 'idle');

  const late = await db.store.checkpoint({
    version: 3,
    runToken: 'run-1',
    phase: 'listing',
    pageToken: null,
    historyId: 'h-late',
    pending: null,
    targetHistoryId: null,
    release: true,
    error: null,
    success: true,
  });
  assert.equal(late, false);
  assert.equal(db.state.historyId, 'h-100');
});

test('an idle scheduler tick does nothing when no run is claimable', async () => {
  const db = fakeDb();
  db.state.running = false;
  let created = false;
  const result = await runGmailSync({
    store: db.store,
    createGmail: async () => {
      created = true;
      return fakeGmail({ messages: [] });
    },
    mailbox: MAILBOX,
  });
  assert.equal(result.status, 'idle');
  assert.equal(created, false);
});

test('authorization failure is reported with reconnect guidance and releases the lease', async () => {
  const db = fakeDb();
  const result = await runGmailSync({
    store: db.store,
    createGmail: async () => {
      throw new GoogleApiError('invalid_grant', 400);
    },
    mailbox: MAILBOX,
  });
  assert.equal(result.status, 'failed');
  assert.match(result.message, /Vuelva a conectar/);
  assert.equal(db.state.leaseLive, false);
  assert.equal(db.checkpoints.at(-1).error, result.message);
});

test('a trusted website notification is recorded with the customer contact, not the sender', async () => {
  const notification = makeMessage('form1', {
    from: 'Formulario Web <forms@sitio.example>',
    headers: [
      header('Auto-Submitted', 'auto-generated'),
      header('Reply-To', 'Carla Ruiz <carla@negocio.com>'),
    ],
    text: 'Nombre: Carla Ruiz\nTeléfono: +1 305 555 0199\nMensaje: Quiero información',
  });
  const gmail = fakeGmail({ messages: [notification] });
  const db = fakeDb({ trustedSenders: ['forms@sitio.example'] });
  const result = await runGmailSync({ store: db.store, createGmail: async () => gmail, mailbox: MAILBOX });

  assert.equal(result.status, 'synced');
  const record = db.records.get('form1');
  assert.equal(record.fromAddress, 'forms@sitio.example');
  assert.equal(record.contactEmail, 'carla@negocio.com');
  assert.equal(record.contactName, 'Carla Ruiz');
  assert.equal(record.contactPhone, '+1 305 555 0199');
});

test('repeated imports of the same messages report duplicates instead of creating them', async () => {
  const gmail = fakeGmail({ messages: fiveMessages.slice(0, 3) });
  const db = fakeDb();
  await runGmailSync({ store: db.store, createGmail: async () => gmail, mailbox: MAILBOX });
  db.state.phase = 'listing';
  db.state.pageToken = null;
  db.state.pending = null;
  db.state.historyId = null;
  const second = await runGmailSync({ store: db.store, createGmail: async () => gmail, mailbox: MAILBOX });
  assert.equal(second.counts.created, 0);
  assert.equal(second.counts.duplicate, 3);
  assert.equal(db.records.size, 3);
});

test('inbox query excludes sent, drafts, spam, and trash after the import date', () => {
  const query = buildInboxQuery(IMPORT_FROM);
  assert.match(query, /^after:\d+/);
  for (const term of ['-in:sent', '-in:drafts', '-in:spam', '-in:trash']) {
    assert.ok(query.includes(term), term);
  }
});

test('empty bodies get a visible placeholder', () => {
  assert.equal(cleanBody('   \n> solo cita'), '(Mensaje sin texto)');
});

test('Gmail client retries transient failures and not client errors', async () => {
  const responses = [new Response('{}', { status: 429 }), new Response('{}', { status: 503 }), new Response(JSON.stringify({ historyId: '7' }), { status: 200 })];
  const delays = [];
  const client = createGmailClient({
    accessToken: 't',
    fetchImpl: async () => responses.shift(),
    sleep: async (ms) => delays.push(ms),
  });
  assert.equal(await client.profileHistoryId(), '7');
  assert.deepEqual(delays, [1000, 2000]);

  let calls = 0;
  const strict = createGmailClient({
    accessToken: 't',
    fetchImpl: async () => {
      calls += 1;
      return new Response('{}', { status: 400 });
    },
    sleep: async () => {},
  });
  await assert.rejects(strict.profileHistoryId(), (error) => error.status === 400);
  assert.equal(calls, 1);
});

test('Gmail list requests are limited to the inbox label', async () => {
  let requested = '';
  const client = createGmailClient({
    accessToken: 't',
    fetchImpl: async (url) => {
      requested = url;
      return new Response(JSON.stringify({ messages: [{ id: 'a' }] }), { status: 200 });
    },
    sleep: async () => {},
  });
  const page = await client.listMessages({ query: 'after:1', pageToken: undefined });
  assert.deepEqual(page.ids, ['a']);
  assert.match(requested, /labelIds=INBOX/);
});
