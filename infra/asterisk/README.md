# PLW phone server

`setup.sh` builds a new server. `plw-agents.sh` adds browser phone logins to a working one.

**Do not run `setup.sh` on the working server.** It rewrites `pjsip.conf` and `extensions.conf`. Once agents exist it refuses to run.

## How the pieces fit

| Secret | Where it lives | Who can get it |
| --- | --- | --- |
| Vocex line password | Only in `/etc/asterisk/pjsip.conf` | Root on the server. It never reaches the app. |
| Agent phone password | `/etc/asterisk/pjsip_agents.conf`, and encrypted in `agent_sip_accounts` | Root on the server, and that agent's browser while logged in. Administrators can replace it but never read it back. |
| `SIP_CREDENTIAL_KEY` | Supabase server secret | The `telephony` server function only. |

The agent's browser receives its password from the `telephony` function after login and keeps it in memory only.

## Deploying

The server comes first, because it works on its own and can be rolled back without touching the app.

### 1. Add the agent login

**On your computer (PowerShell, in the repository folder):**

```powershell
scp infra/asterisk/plw-agents.sh root@207.246.112.58:/root/plw-agents.sh
ssh root@207.246.112.58
```

**On the Ubuntu server:**

```bash
install -m 700 /root/plw-agents.sh /usr/local/sbin/plw-agents
plw-agents setup agent-1
```

It makes a backup in `/root` and prints the file name. Keep that name, because rollback needs it. If anything fails it says so and puts the backup back by itself.

If your successful outgoing echo test used `506` in front of the number, run this instead:

```bash
VOCEX_PREFIX=506 plw-agents setup agent-1
```

Then check the result. The line must show `Registered`:

```bash
asterisk -rx 'pjsip show registrations'
asterisk -rx 'pjsip show endpoint agent-1' | grep -E 'Endpoint:|webrtc'
```

### 2. Add the backend

**On your computer (PowerShell, in the repository folder).** The key is created here and never displayed:

```powershell
supabase db push
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$key = -join ($bytes | ForEach-Object { $_.ToString('x2') })
supabase secrets set "SIP_CREDENTIAL_KEY=$key"
Remove-Variable key, bytes
supabase functions deploy telephony
```

If this key is ever replaced, enter every agent's password again.

### 3. Publish the app

Publish the new build the way you normally publish the site. The microphone only works on `https://` or `localhost`.

To test on `http://localhost:5173` with `npm run dev` instead, that address counts as a new device, so it needs an office enrollment code the first time.

### 4. Put the password into the app

The password goes from the server into your clipboard without appearing on screen. `plw-agents` refuses to print it to a terminal.

**On your computer (PowerShell):**

```powershell
ssh root@207.246.112.58 plw-agents password agent-1 | Set-Clipboard
```

**In the app:** log in as administrator, open **Agentes**, choose **Teléfono** on the agent's card, paste into **Contraseña SIP**, and save. The other fields are already filled in.

**On your computer (PowerShell)**, clear the clipboard:

```powershell
Set-Clipboard -Value ' '
```

If Windows clipboard history is on (Win+V), delete the entry there too. Never send this password by chat or email.

### 5. Log in as the agent

The agent must be enabled and have a PIN. After login the phone panel should say **Línea registrada**. The browser asks for the microphone on the first call. Choose **Allow**, because audio can't connect without it.

## Validating

A running WSS service does not prove any of this. Only a real call does. While testing, watch on the **Ubuntu server**:

```bash
asterisk -rx 'pjsip show contacts'         # agent-1 should be Avail
asterisk -rx 'core show channels'          # calls in progress
asterisk -rx 'pjsip show registrations'    # Vocex should stay Registered
tail -f /var/log/asterisk/messages
```

| # | Test | Passes when |
| --- | --- | --- |
| 1 | Agent logs in | The panel says **Línea registrada**, and `pjsip show contacts` lists `agent-1`. |
| 2 | Call your mobile from the app | It rings, you answer, and **each side hears the other**. |
| 3 | Hang up in the app during a call | The mobile disconnects, and `core show channels` shows none. |
| 4 | Call again, hang up on the mobile | The app shows **Finalizada** and the agent returns to normal. |
| 5 | Mute during a call | The mobile stops hearing the agent. The agent still hears the mobile. |
| 6 | Call +506 4010 6199 from the mobile | The app rings and shows **Contestar**. After answering, **each side hears the other**. |
| 7 | Call in, press **Rechazar** | The mobile gets a busy tone. |
| 8 | Call in, don't answer | After 25 seconds the mobile gets the carrier's unavailable message. |
| 9 | Call in with the agent logged out | The mobile gets the carrier's unavailable message right away. |
| 10 | Dial `12345678` or `15551234567` | The app refuses it, and no call appears in `core show channels`. |
| 11 | After all of the above | `pjsip show registrations` still shows `Registered`. |

## Rolling back

**On the Ubuntu server**, using the backup name that setup printed. This removes the agent logins, restores the echo test and undoes the `identify_by` line:

```bash
plw-agents rollback /root/asterisk-backup-YYYYMMDD-HHMMSS.tar.gz
```

If the `plw-agents` command is gone, the same thing by hand:

```bash
rm -f /etc/asterisk/pjsip_agents.conf
tar -C /etc -xzf /root/asterisk-backup-YYYYMMDD-HHMMSS.tar.gz
asterisk -rx 'module reload res_pjsip.so'
asterisk -rx 'dialplan reload'
asterisk -rx 'pjsip show registrations'
```

The app needs no rollback. Without a working server the phone panel shows an error and nothing else is affected.

## Everyday tasks

**Add another agent.** List every agent, with the one who receives incoming calls first. Existing passwords stay the same. Then repeat step 4 for the new agent.

```bash
plw-agents setup agent-1 agent-2
```

**Replace a password**, for example when someone leaves. Do this as well as disabling them in the app, because disabling only stops the app from handing out the password. A login the person already copied keeps working until it is replaced. Then repeat step 4.

```bash
plw-agents rotate agent-1
```

## If something goes wrong

| What you see | Likely cause | What to do |
| --- | --- | --- |
| **Error de conexión**, can't reach the server | The office network blocks port 8089, or the IP was banned | Open `https://phone.professionallatinoworkers.com:8089/ws` in the browser. A certificate warning or a timeout points to the network. |
| Worked, then stopped from one office | Fail2ban blocks an IP for an hour after 5 wrong passwords | On Ubuntu: `fail2ban-client set asterisk unbanip THE_IP` |
| **El servidor rechazó la cuenta de teléfono** | The password in the app doesn't match the server | Repeat step 4. |
| The call ends after 10 seconds with **no hubo conexión de audio** | Audio can't pass between the browser and the server | Make sure the browser's microphone permission is set to **Allow**: without it Chrome hides its address and Asterisk can't connect the audio. Then check that UDP 10000-20000 is open in any Vultr firewall group and on the office network. In Chrome, `chrome://webrtc-internals` shows the connection state. |
| Outgoing calls fail, incoming work | Vocex wants a different number format | Run setup again with or without `VOCEX_PREFIX=506`. |

## Known limits

- One browser per agent. A second tab takes over from the first.
- Every incoming call rings one agent, even if that agent is on pause.
- Hold, transfer and keypad tones during a call aren't available yet.
- 911 and other short codes can't be dialed from the app.
- The agent's own browser has to hold the phone password to log in, so a technical agent could extract it. It only works for calls to Costa Rican numbers. Replace it when an agent leaves.
