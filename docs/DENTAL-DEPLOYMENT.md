# PLW dental dialer deployment

Prepared November 10, 2026. Target only `meagbbmittuhdgwnhvxa` and the existing PLW app. Repository base: `e57709d758dc0e07b562daf4adb168b82304e953`.

## Confirmed live work

- The dental campaign and lead schema, migration `20261110080000`, was applied through Bolt's database editor and recorded in migration history.
- 416 unique public dental telephone contacts were imported. The live SQL result showed **Alejandro 208; Valeska 208**.
- Contacts cover all seven provinces; 62 have an unconfirmed province. This is an initial sourced list, not a complete census or a guarantee that every telephone still answers.
- The initial dentist search and assignment pages are saved in the repository at the base commit above. Publication was not confirmed.
- No dentist was called and no automatic campaign was activated.

## This update

`/admin/marcador-ia` becomes the dental control panel. Select Alejandro or Valeska, then activate, pause/freeze, resume or stop. The original general dialer remains at `/admin/marcador-general`.

Agents have `/dentistas` and `/llamadas-dentales`. They can read only their own leads and dental conversations. Administrators see both. Transcripts and call history refresh every 15 seconds when the provider makes the data available; this is not guaranteed word-by-word streaming.

The server limits dental calls to two per agent and four overall, and checks business hours, enabled staff, recent active presence and the global do-not-call list. One persistent reservation per lead prevents automatic redial after reload or an ambiguous provider timeout. Pause and Stop prevent new attempts; calls already submitted may finish. Failed, cancelled and uncertain attempts remain visible and are not automatically retried.

Each agent gets a separate ElevenLabs dental agent. The existing inbound agent and webhook are not edited. Ana introduces herself with the dentist-specific opening, proactively pitches reception coverage, multilingual answering, pre-visit forms and the included website, and uses the owner's 13 years of US-market experience. Unsupported exclusivity claims are not included.

A transfer tool invocation means **requested**, not delivered. Only the assigned receiving agent can press **Recibí esta transferencia**. An actual test confirmation unlocks that agent's transfer gate. This records the receiving agent's acknowledgement; it is not automatic carrier proof.

## Limited Alejandro pilot exception (migration `20261110151741`)

This narrow exception allows a bounded pilot before Alejandro's real transfer confirmation exists. It does not change the general rule above for the full campaign.

- Scope: Alejandro (`agent-2`) only, at most 20 new non-test attempts, two simultaneous. The limit is enforced in the database. Reservations, provider rejections and uncertain results all consume it. A test call to an administrator's own phone does not.
- When the limit is reached, the dialer pauses automatically and the server refuses further attempts. Calls already started may finish. Uncertain attempts are never redialed automatically.
- Transfers made during the pilot stay marked **unverified** until Alejandro receives one and confirms it in his own history. A requested transfer or Ana's spoken words do not count as confirmation.
- Valeska's dialer, the general dialer, WhatsApp, Gmail and the inbound receptionist are not changed by this exception. Valeska's test is not a prerequisite for Alejandro's pilot.
- Before activation, Ana's script and voice must be verified in the provider and a fresh server heartbeat must be present. Nothing in the database or this document may be used to fabricate those checks.
- The pilot's status, error messages and rules are described in `docs/DENTAL-PILOT-20.md`. Rollback is the same as above: stop Alejandro first and keep the migration and its limit in place.

## Configuration verification, Valeska pilot and incoming alert

- `Configurar Ana` reads the existing dedicated agent with server credentials. If it differs from the stored script, voice, recipient or tool rules, the server sends one update to that same dedicated agent and checks again. It never creates a second agent and never touches the shared inbound agent. Failure returns only the failed check names (for example `workflow` or `extra_tools_or_knowledge`); no keys or tokens are shown. Line-ending and edge-whitespace differences are the only normalization accepted.
- The dedicated agent is now created and updated with explicitly empty tools, MCP servers, knowledge base and workflow, so leftover provider defaults cannot pass as Ana's configuration.
- Valeska (`agent-3`) has the same bounded first pilot as Alejandro: 20 new non-test attempts, two simultaneous per agent, four overall, automatic pause, no automatic redial. Transfers stay unverified until the receiving agent confirms one. Her pilot labels use her name.
- Each dialer page has one `Control del marcador` region for the selected agent. Its controls and history use distinct keys per agent.
- When a call rings the signed-in agent, a large alert shows the dentist's name, phone, assigned agent, location and Ana's summary, with Answer, Reject and a link to the call history. The alert opens only when the SIP invitation carries a valid `X-PLW-Dental-Call` UUID. The lead is loaded by that exact call id and only if it is assigned to the signed-in agent and still open. A missing, malformed, mismatched, or failed lookup shows an unknown state, never a guessed lead. The alert never marks a transfer as received; only **Recibí esta transferencia** does that. The phone system must forward the `X-PLW-Dental-Call` header to the browser; this has not been verified end to end.

## Remaining live work — not completed

1. Apply migrations `20261110090000_dental_dialer_controls.sql` and `20261110091000_dental_scheduler.sql` to the exact PLW backend. Do not rerun `20261110080000`: it already exists live. Its source in this package restores the schema contract for fresh local test databases; reconcile it with the migration-history SQL before treating it as an exact historical copy.
2. Deploy the complete `dental-dialer` function and imported dependencies: `dental-dialer/{index.ts,provider.js,runner.js}`, `ai-outbound-test-call/{auth.ts,salesScript.js}` and the existing `elevenlabs-webhook/rules.js`. Its handler validates a live administrator session or a dedicated Vault scheduler key. Keep the configured `verify_jwt=false` only with that handler authentication intact.
3. Confirm `ELEVENLABS_API_KEY` is present server-side and the existing `ai_outbound_settings` contains the intended voice and SIP caller-number IDs. Do not copy secrets into frontend files or this package.
4. Publish the frontend and sign in as administrator. For each agent, use **Configurar Ana**. This creates a dedicated provider agent, verifies its script and fixed destination, and enables the scheduler. The migration alone does not enable the scheduler or start calls.
5. Have Alejandro and Valeska sign in, select active availability and register their browser phones. Place controlled test calls only to numbers supplied by the administrator. Confirm two-way audio, actual ringing of the selected agent, and the returned transcript. The receiving agent confirms the test in their own history.
6. Test two simultaneous interested calls, an agent who becomes busy/offline, and rejection of a transfer. Inspect the real PBX/SIP route; the checked-in Asterisk setup does not establish a verified dedicated dental transfer path. Do not broadly enable SIP forwarding or modify the inbound queue. A queued or busy-safe transfer route must be verified before launching two calls per agent.
7. Check the scheduler heartbeat, then activate each agent deliberately. Calls run Monday–Friday, 09:00–17:00 Costa Rica time, only while that agent is available. No unattended launch has been scheduled by this handoff.

The previous `PLW-Dialer-Fixes.txt` package has separate changes to the original test-call function and shared webhook. Those changes are not deployed by this dental-only update. Do not claim them live without deploying and testing their matching backend and frontend together.

## Access blockers observed

- The connected Supabase account did not list the PLW backend.
- Bolt's assistant reported no tokens available.
- Further Bolt browser access was rejected by automatic approval review because this ChatGPT session hit a usage limit. The final frontend update and backend deployment were not performed.
- Public GitHub upload of this new update was rejected by automatic approval review because the code/documentation includes backend identifiers and SIP routing details. No new tree, branch or pull request was published. The package is being supplied privately.
- The browser's app preview was at the sign-in screen. No current signed-in administrator session or controlled live transfer was available for the final verification.

## Verification

Latest local results: **276 backend tests and 87 UI tests passed**. Type checking, lint, production build and Deno function checking passed. The build reports an existing bundle-size warning; it does not prevent compilation. Provider-specific tests use mocked HTTP calls, and database tests use a local PostgreSQL-compatible test database.

Run `npm ci --ignore-scripts`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npx --yes deno check --no-lock supabase/functions/dental-dialer/index.ts`.

Automated checks cover ownership boundaries, admin-only controls, scheduler access, two/four-call limits, office hours, stale/busy presence, opt-outs, idempotent tests, provider uncertainty, exact transcript identity and requested-versus-confirmed transfers. They do not prove live carrier routing, voice quality, all phone-number validity, browser microphone behavior or sustained production operation.

Read-only live assignment check:

```sql
SELECT s.display_name AS agente, count(*) AS dentistas
FROM public.dental_leads d
LEFT JOIN public.staff_profiles s ON s.id=d.owner_staff_id
WHERE d.campaign_id='8874ff6c-c9c1-5a63-955c-12329af5aa01'
GROUP BY s.display_name ORDER BY s.display_name;
```

## Rollback

Stop both dental agents first. Preserve calls, assignments and do-not-call entries. Disable the `plw-dental-dialer` cron job if it was enabled. Restore the previous frontend if necessary. Do not drop the new tables or reset campaign progress. Leave other integrations and the existing inbound receptionist unchanged. Resolve ambiguous provider calls before releasing reserved capacity.
