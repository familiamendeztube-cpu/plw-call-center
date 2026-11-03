# Queue availability and server call reporting

This change is prepared for the working `plw-inbound` round-robin queue. It has
not been installed on the production server. Do not run the original setup.sh
or plw-agents setup: they replace the incoming dialplan.

## Behavior

- An outbound-only worker on the Asterisk VPS polls a dedicated Edge Function.
  No new inbound ports, public AMI, database password, service-role key or SIP
  credentials are installed in the worker.
- It uses the explicit agent_sip_accounts staff-to-SIP mapping. A member may
  receive queue calls only when enabled, active, outside after-call work, and
  with an app heartbeat no older than 90 seconds. Normal polling is 5 seconds;
  network requests and CLI operations can extend that delay. Unexpected tab or
  network loss expires after approximately 90 seconds plus a poll cycle.
- The queue still uses Asterisk device state to skip missing browser contacts
  and ongoing calls. device_state_busy_at=1 makes this include outbound calls.
- Startup, shutdown and failed eligibility requests pause queue members. An
  active call is not disconnected. A worker crash causes systemd to pause
  members and restart it. A full host failure remains a carrier/server outage.
- Pausa/Activo remain the source of truth in the app. Manual CLI unpause/pause
  is overwritten by the next sync. Disabling an agent stops incoming queue
  assignment; it does not rotate their SIP password or revoke outbound SIP
  access already copied. Keep using credential rotation for offboarding.
- CDR records are written on the server when calls finish, then persisted in
  a root-only SQLite outbox before upload. Failed uploads retry; unique IDs
  make replay harmless. Separate CDR sequences are retained and grouped by
  linked ID/direction for the report, so a customer call isn't counted twice.
- Admin Resumen includes the last 30 days of completed inbound/outbound calls,
  answered outbound calls, unsuccessful outbound calls and talk minutes.
  Unanswered inbound calls belong to the queue, not the last agent attempted.
  It explicitly warns if the backend result limit truncates the report.
- Reporting starts at installation, not retroactively. This is CDR-based
  reporting, not recordings, billing reconciliation, or per-agent missed-ring
  attempt reporting. Hold/transfer are not implemented; test reporting again
  before enabling transfers. Reassigning a SIP login before delayed records
  upload can attribute that historical record to the new owner; do not recycle
  logins during an upload backlog.
- Disk logs survive browser loss and ordinary worker restarts; they are not a
  backup against server loss. Logs rotate daily with 30 uncompressed copies.
  An outage longer than retention or disk exhaustion requires intervention.

## Deployment — one stage at a time

Review and deploy from feature/asterisk-queue-sync. Preserve the user's other
local edits. First validate the linked project and migration dry run:

```powershell
supabase migration list --linked
supabase db push --linked --dry-run --skip-vault
```

Only push if the pending list is the reviewed new call-record migration (or
other independently reviewed migrations). Do not use --include-all blindly.

```powershell
supabase db push --linked --skip-vault
supabase secrets list --project-ref meagbbmittuhdgwnhvxa
```

If ASTERISK_BRIDGE_TOKEN already exists, use the existing value from your
password manager. Never replace it blindly. Otherwise create a distinct token
on your computer and upload it without displaying its value:

```powershell
$plwBridgeBytes = New-Object byte[] 32
$plwBridgeRng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $plwBridgeRng.GetBytes($plwBridgeBytes)
  $plwBridgeToken = -join ($plwBridgeBytes | ForEach-Object { $_.ToString('x2') })
  supabase secrets set "ASTERISK_BRIDGE_TOKEN=$plwBridgeToken" --project-ref meagbbmittuhdgwnhvxa
  if ($LASTEXITCODE -ne 0) { throw 'Secret upload failed; do not install the worker yet.' }
  Set-Clipboard -Value $plwBridgeToken
} finally {
  $plwBridgeRng.Dispose()
  Remove-Variable plwBridgeToken, plwBridgeBytes -ErrorAction SilentlyContinue
}
```

Save the clipboard value in your password manager. Do not paste into chat,
source code or screenshots. This token can read availability and submit call
records; it cannot read SIP passwords. Protect it like a password.

```powershell
supabase functions deploy asterisk-bridge telephony --project-ref meagbbmittuhdgwnhvxa --use-api
scp -r infra/asterisk/bridge root@207.246.112.58:/root/plw-queue-bridge
ssh root@207.246.112.58
```

On Ubuntu (keep a second SSH session open):

```bash
python3 /root/plw-queue-bridge/install.py
```

Enter project `meagbbmittuhdgwnhvxa`, then paste the SAME bridge token at the
hidden prompt. This is not your SIP password and not SIP_CREDENTIAL_KEY.
It refuses unexpected CDR configuration instead of overwriting it. If it
refuses, stop and review the existing files without printing credentials.
Installation backs up /etc/asterisk (excluding certificates), writes logging
config, starts the worker and reloads modules; it does not restart Asterisk,
change the working queue dialplan, change number prefixes or rotate passwords.
Save the printed backup path. On failure it restores the Asterisk config;
check queue and trunk state before accepting any further changes.

Back in local PowerShell clear the clipboard and its Win+V history:

```powershell
Set-Clipboard -Value ' '
```

Publish the app using the existing hosting process after testing locally.
The worker uses existing backend presence; it does not depend on the new
report UI being published.

## Live validation (required; not claimed by unit tests)

On Ubuntu:

```bash
systemctl status plw-bridge --no-pager
asterisk -rx 'queue show plw-inbound'
asterisk -rx 'cdr show status'
asterisk -rx 'module show like cdr_custom'
asterisk -rx 'pjsip show registrations'
journalctl -u plw-bridge -n 30 --no-pager
```

1. All three browser phones register; Activo plus a fresh heartbeat unpauses
   the corresponding queue member. Unmapped members must stay paused.
2. Click Pausa for agent-3; verify `(paused)` in queue show after sync. Call
   the line and verify only the other two agents are selected.
3. Click Activo; verify unpause and real inbound two-way audio.
4. Make an outbound call on agent-1; call inbound simultaneously and verify
   the busy agent is skipped (requires carrier concurrency to test properly).
5. Normal logout pauses the member after sync. Kill/close a tab; verify
   missing contact skips it, and heartbeat expires within the documented TTL.
6. Stop the worker: queue members pause. Start it: eligible agents resume.
   Ongoing calls must remain connected. Test API outage in staging, never
   rotate the production token as a connectivity test.
7. Complete one inbound and one outbound call for each agent. Refresh the
   admin report and verify the right names, directions, outcomes and talk
   time. Unanswered inbound belongs to queue. Call while app then browser
   closes; server still records the final call after disconnect.
8. Retry upload/restart worker and confirm totals do not double. Use staging
   for simulated outage and log rotation, including a restart after rename.
9. Confirm unauthenticated bridge requests return 401 and an ordinary agent
   cannot call the admin report action. Run Supabase database advisors after
   migration and review results; no browser table grants are needed.
10. Vocex remains Registered and outbound dialing format is unchanged.

If the report stays empty, check module state, the existence/size (not the
contents in screenshots) of `/var/log/asterisk/cdr-custom/plw.csv`, worker
journal, database migration and matching server token. Logs contain phone
numbers; never paste full CDR logs into chat.

## Rollback

Stop/disable the worker first (this pauses queue members):

```bash
systemctl disable --now plw-bridge
```

Restore the printed `plw-before-bridge-...tar.gz` backup under /etc. Remove
cdr.conf and cdr_custom.conf only if this installer created them (the first
installer refuses if they existed), then reload the custom CDR module,
res_pjsip and app_queue. Manually unpause agents that should receive calls;
the worker is no longer controlling their state. Keep the SQLite outbox and
CDR logs for later reconciliation; do not delete call history or secrets.
The additional database table can remain private and unused. Do not roll
back to an old SIP credential backup simply to remove the report UI.

## Local checks

```bash
python3 -m unittest discover -s infra/asterisk/bridge -p 'test_*.py'
node --test scripts/asteriskBridge.test.mjs
npm test
npm run typecheck
npm run lint
npm run build
```
