# MVP Checklist: Professional Latino Workers Call Center

Status key: Done = finished and verified. Partial = started, not finished. Open = not started.

## 1. Staff access

### Implementation
- Done: agent sign-in with PIN, administrator sign-in, owner setup, office computer enrollment, session revocation.
- Done: administrator agent management (display name, PIN set and reset, enable or disable, capacity).

### Testing
- Done (offline): agent access isolation, PIN configuration, enrollment codes, session revocation.
- Open (live): administrator checks on the published app. Blocked on the owner passcode.
- Open: keypad browser check at 390px and desktop.

### Owner configuration
- Owner setup passcode.
- Publish the app.

## 2. Incoming email (Gmail receiving)

### Implementation
- Done: background scheduler (pg_cron calls the sync endpoint every minute with a vault secret).
- Done: sync state, thread and message tables with a unique mailbox and message ID constraint. RLS is on for every Gmail table; the Gmail functions are not callable by anonymous or signed-in browser roles, and the two administrator functions check for an administrator inside.
- Done: atomic intake function that creates the customer, conversation and queue entry together, reusing round-robin and the waiting queue.
- Done: Gmail client with retries, pagination, expired history cursor recovery.
- Done: per-run ownership token with a short lease. Every checkpoint and every imported message must present the current token and connection version. Pausing, changing the import date, a takeover by a newer run, and disconnecting all invalidate the token. Old runs cannot write.
- Done: import progress is saved after each message, so an interrupted run resumes at the next unprocessed message. Deleted or missing messages are counted as skipped and do not block the queue.
- Done: pure parser skips sent, drafts, spam, trash, bounces, vacation and other automated mail. Mail from a trusted website or form sender (listed in the notification sender table) is accepted when it is auto-generated; the customer is taken from Reply-To or the form's email field, and the name and phone are kept only when supplied. The notification sender is never stored as the customer.
- Done: `google-workspace` edge function deployed with the sync route.
- Done: administrator sync card refreshes every 15 seconds and when the tab regains focus, shows Sin conectar, Error de sincronización, En pausa, Importando correos, Esperando la próxima revisión, or Sincronizado. "Sincronizado" appears only after a successful backend checkpoint.
- Done (code): the open conversation refreshes every 20 seconds and on tab focus. Refreshes update the data quietly, so the reply editor stays mounted and keeps unsaved text.
- Done: administrator sync controls on the integrations page (start or pause, import date, last success and last error).

### Testing
- Done (offline, 89 of 89 tests pass across the suite): progress across budgeted passes (five messages processed in repeated runs), skipped and deleted messages not blocking, pause and resume, takeover by a newer run, disconnect while an import waits, trusted form contacts, direct customer mail, bounces, vacation replies and spam still excluded, parser and HTML handling, retries, admin sync state labels, and the quiet-refresh rule that keeps a loaded conversation on screen when a reply arrives. These use fake storage, a fake Gmail client and a model of the database rules.
- Done (database, run in a rolled-back transaction, passes): 12 threads split 4/4/4; paused and disabled agents receive nothing; a 13th thread waits and drains when capacity opens; a repeated message is a duplicate; a reply keeps the owner and marks the conversation unread; a live checkpoint saves the page position and a foreign token cannot; a paused run is refused; resume keeps the saved position under a new token; takeover refuses the older token; a trusted form stores the customer contact and keeps the sender on the message; after a disconnect, the token is cleared and a late import writes nothing.
- Blocked: two-session tests (two database connections racing for the same lock). The database extension needed for this is not installed, so these checks are not run. The concurrency rules are covered only by the offline model.
- Open: browser check of the conversation refresh (typing while a reply arrives) and the sync card states. No browser is available in this environment.
- Not tested live: no real Gmail messages have been imported.

### Owner configuration
- Google Cloud project with the Gmail API enabled.
- OAuth consent screen with only `gmail.readonly` and `gmail.send`.
- Web OAuth client with callback `${SUPABASE_URL}/functions/v1/google-workspace/oauth/callback`.
- Server secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PLW_GOOGLE_TOKEN_KEY` (32+ characters), `PLW_APP_ORIGIN`.
- Trusted website or form senders: add the address to the trusted notification sender list before their messages will be imported.
- Connect the Plw@professionallatinoworker2026.com account, then start synchronization from the integrations page. Google is not connected yet, so synchronization cannot start.

## 3. Outgoing replies

Status is tracked per stage. Nothing below is marked live-tested.

- Implemented (database): recipient resolution per conversation with Reply-To and form-customer handling, a durable outbox with stable request and Message-ID, atomic claim with stale-worker protection, uncertain sends held in "Confirmando envío" and never resent automatically, and revision-guarded drafts owned by each agent.
- Implemented (backend modules): UTF-8 MIME builder, Gmail sender with error classification, and the outbox processor (send, reconcile by Message-ID, settle).
- Implemented (HTTP routes and store): reply target, send request, outbox status and draft save routes in the Google Workspace function, deployed.
- Implemented (app): reply composer with server-resolved recipient, revision-guarded draft autosave, single send button with stable request ID, and status labels (En cola, Enviando, Enviado, No se pudo enviar, Confirmando envío).
- Implemented (database): the outbox and draft write path is only reachable through the server functions; direct writes to the outbox are revoked from the app roles.
- Tested offline: 21 mocked tests for MIME, UTF-8, headers, sender errors, double-send prevention, accept-then-timeout reconciliation and rejection handling.
- Tested against the database: the constraint, grant, RLS and ownership checks pass against the live database.
- Not yet tested: the Message-ID fetch for older imports, and the scheduled tick that runs the outbox.
- Not tested in browser: no browser is available in this environment.
- Not tested with live Gmail: blocked until the owner connects Google and approves a controlled test recipient.
- Owner configuration still needed: connect the Google account and approve a controlled test recipient.
- Open: staff ownership under a real staff session has not been exercised in the app.

## 4. Calling

- Open: Vocex SIP line configuration (owner).
- Open: live call testing.
- Note: the telephony screens exist; no real calls are placed.

## 5. Sales materials

- Done: material library screens.
- Open: owner review of the approved materials and their content.
- Open: material upload and sharing.

## 6. Final verification

- Done: `npm run typecheck` passes.
- Done: `npm run lint` passes.
- Done: `npm run format:check` passes.
- Done: `npm test` passes (89 of 89).
- Done: `npm run build` passes.
- Done: Deno type check passes on `index.ts`, `syncTickHandler.ts`, `syncStore.ts`, `gmailParser.js`, `mailHeaders.js`, `leadNotification.js`, `gmailClient.js` and `syncEngine.js` in the `google-workspace` function. The test files are Node tests and are not covered by Deno.
- Done: `google-workspace` deployed with the deploy tool after the changes.
- Done: the receiving SQL regression test passes against the database (rolled back, no leftover data).
- Done: both new migrations (gmail sync fencing and contacts, trusted notification senders) are in the migration list.
- Partial: the security advisor ran, but its output was too large to read in full here. I checked the Gmail functions and tables directly (access grants and RLS) instead; the remaining advisor findings predate this stage and were not reviewed.
- Open: browser checks at 1440, 1280, 768 and 390px for the administrator and the customer screens. No browser is available in this environment.
