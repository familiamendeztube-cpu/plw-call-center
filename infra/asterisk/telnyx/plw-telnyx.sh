#!/usr/bin/env bash
# Adds the US line: Telnyx as a second trunk on this Asterisk, next to Vocex.
#   - Anna's US calls (ElevenLabs, login plw-us-dialer) go out through Telnyx with the US
#     number as caller ID. Only +1 numbers; 900/976 premium numbers are refused.
#   - Her transfers ring Alejandro's browser phone, then the call center queue.
#   - Agents' browser phones call US numbers (+1 and 10 digits) through Telnyx, US number as
#     caller ID. Added next to their existing Costa Rica lines in from-agents; the app only
#     offers US numbers (owner, 2026-11-26: every outbound call goes to the US).
#   - Calls to the US number go to the same queue as Costa Rica calls, named "EE. UU.".
#   plw-telnyx install          Adds the setup. Asks for the Telnyx SIP login and the US number.
#   plw-telnyx password         Prints only ElevenLabs' login password, for a pipe.
#   plw-telnyx rollback FILE    Puts a backup back.
# Nothing existing is edited: Vocex, 6199, 6198, the queue, the agents' lines and the
# dental/tourism route stay as they are. Everything lives in pjsip_telnyx.conf and
# extensions_telnyx.conf, included at the end of the main files (Asterisk merges the extra
# from-agents lines into the existing context). Needs plw-dental installed first (it provides
# the login-based recognition ElevenLabs needs).
set -euo pipefail
umask 027

readonly CONF_DIR=${PLW_CONF_DIR:-/etc/asterisk}
readonly BACKUP_DIR=${PLW_BACKUP_DIR:-/root}
readonly PJSIP_FILE=$CONF_DIR/pjsip_telnyx.conf
readonly DIALPLAN_FILE=$CONF_DIR/extensions_telnyx.conf
readonly HOST=phone.professionallatinoworkers.com
readonly LOGIN=plw-us-dialer
readonly AGENT=agent-2 # Alejandro: US customers and transfers go to him.
# Telnyx US signaling IPs (developers.telnyx.com, SIP trunking > failover and retries).
readonly TELNYX_IPS=(192.76.120.10 64.16.250.10)

die() {
  echo "ERROR: $*" >&2
  exit 1
}

ast() { asterisk -rx "$1"; }

# Reads all of its input (unlike grep -q), so "pipefail" can't fail on a closed pipe.
has() { grep -E "$1" >/dev/null; }

telnyx_registered() { ast 'pjsip show registrations' | grep -E '^ *telnyx/' | has 'Registered'; }

check_ready() {
  [[ $EUID -eq 0 ]] || die "Run as root."
  [[ ! -e $PJSIP_FILE && ! -e $DIALPLAN_FILE ]] ||
    die "Already installed. Use 'plw-telnyx rollback BACKUP' first to reinstall. Nothing changed."
  [[ -e $CONF_DIR/pjsip_dental.conf ]] ||
    die "Install plw-dental first (infra/asterisk/dental). Nothing changed."
  ast 'pjsip show settings' | grep -i 'endpoint_identifier_order' | has 'auth_username' ||
    die "Login-based recognition (auth_username) is not active. Nothing changed."
  grep -q '^\[transport-elevenlabs-tls\]' "$CONF_DIR/pjsip_elevenlabs.conf" ||
    die "The ElevenLabs TLS transport is missing. Nothing changed."
  grep -q '^\[transport-udp\]' "$CONF_DIR"/pjsip*.conf ||
    die "The UDP transport is missing. Nothing changed."
  grep -qxF "[$AGENT]" "$CONF_DIR/pjsip_agents.conf" ||
    die "Agent login $AGENT is missing. Nothing changed."
  grep -q '^\[from-agents\]' "$CONF_DIR/extensions.conf" ||
    die "The agents' dialplan (from-agents) is missing. Nothing changed."
  ! ast 'dialplan show from-agents' | has '_\+1' ||
    die "from-agents already has +1 lines. Remove them by hand first. Nothing changed."
  ast 'queue show plw-inbound' | has '^plw-inbound has' ||
    die "The call center queue plw-inbound is missing. Nothing changed."
}

write_pjsip() {
  local user=$1 password=${2//;/\\;} login_password=$3
  {
    echo '; PLW US line (Telnyx), written by plw-telnyx. See infra/asterisk/telnyx in the repo.'
    cat <<EOF

[$LOGIN]
type=auth
auth_type=userpass
username=$LOGIN
password=$login_password

; Anna's US calls from ElevenLabs: recognised only by this login, never by From or IP.
[$LOGIN]
type=endpoint
transport=transport-elevenlabs-tls
identify_by=auth_username
auth=$LOGIN
context=from-elevenlabs-us
disallow=all
allow=ulaw,alaw
media_encryption=sdes
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
allow_transfer=yes
allow_subscribe=no

[telnyx]
type=auth
auth_type=userpass
username=$user
password=$password

[telnyx]
type=aor
contact=sip:sip.telnyx.com:5060

; Registered so calls to the US number reach this server.
[telnyx]
type=registration
transport=transport-udp
outbound_auth=telnyx
server_uri=sip:sip.telnyx.com
client_uri=sip:$user@sip.telnyx.com
contact_user=$user
retry_interval=60
forbidden_retry_interval=600
expiration=600
line=yes
endpoint=telnyx

; Incoming calls are accepted only from Telnyx's US signaling IPs and only reach Alejandro
; or the queue (from-telnyx), so nothing can be dialed out through here.
[telnyx]
type=endpoint
transport=transport-udp
context=from-telnyx
disallow=all
allow=ulaw
outbound_auth=telnyx
aors=telnyx
from_domain=sip.telnyx.com
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes

[telnyx]
type=identify
endpoint=telnyx
EOF
    local ip
    for ip in "${TELNYX_IPS[@]}"; do echo "match=$ip"; done
  } >"$PJSIP_FILE"
}

write_dialplan() {
  local number=$1
  {
    echo '; PLW US line (Telnyx), written by plw-telnyx. See infra/asterisk/telnyx in the repo.'
    cat <<EOF

; Anna calling a US business. +1 numbers only (with or without +1/1), area and exchange
; starting 2-9; 900 and 976 premium numbers are refused. TRANSFER_CONTEXT makes Asterisk
; carry out her transfers in plw-us-transfer. The US number is the caller ID.
[from-elevenlabs-us]
exten => _+1NXXNXXXXXX,1,Goto(\${EXTEN:2},1)
exten => _1NXXNXXXXXX,1,Goto(\${EXTEN:1},1)
exten => _900NXXXXXX,1,Hangup(21)
exten => _976NXXXXXX,1,Hangup(21)
exten => _NXXNXXXXXX,1,Set(TRANSFER_CONTEXT=plw-us-transfer)
 same => n,Set(__PLW_US_CUSTOMER=+1\${EXTEN})
 same => n,Set(CALLERID(num)=$number)
 same => n,Dial(PJSIP/+1\${EXTEN}@telnyx,60)
 same => n,Hangup()
exten => _X.,1,Hangup(21)
exten => _+X.,1,Hangup(21)

; Anna hands an interested business to Alejandro. Only his browser login can be reached, so
; a transfer can never become a paid call.
[plw-us-transfer]
exten => $AGENT,1,Gosub(plw-us-ring,s,1($AGENT))
 same => n,Hangup()

; Calls to the US number: the same queue as Costa Rica calls, so every active agent can take
; them. The name "EE. UU." shows on the phone; the app also labels the number's country.
[from-telnyx]
exten => _[+0-9a-zA-Z].,1,Goto(s,1)
exten => s,1,Set(CALLERID(name)=EE. UU.)
 same => n,Queue(plw-inbound,,,,60)
 same => n,Hangup()

; Agents calling the US from the browser phone; the app sends +1 and 10 digits. These lines
; join the existing from-agents context, whose Costa Rica lines are not changed.
[from-agents]
exten => _+1NXXNXXXXXX,1,Goto(plw-agents-us,\${EXTEN:2},1)

[plw-agents-us]
exten => _900NXXXXXX,1,Hangup(21)
exten => _976NXXXXXX,1,Hangup(21)
exten => _NXXNXXXXXX,1,Set(CALLERID(num)=$number)
 same => n,Dial(PJSIP/+1\${EXTEN}@telnyx,60)
 same => n,Hangup()
exten => _X.,1,Hangup(21)

; The agent sees the business's number. If Alejandro is busy or doesn't answer in 25 s, the
; call center queue tries everyone for 30 s.
[plw-us-ring]
exten => s,1,Set(CALLERID(all)=EE. UU. <\${PLW_US_CUSTOMER}>)
 same => n,Dial(PJSIP/\${ARG1},25,r)
 same => n,GotoIf(\$["\${DIALSTATUS}" = "ANSWER"]?done)
 same => n,Queue(plw-inbound,,,,30)
 same => n(done),Return()
EOF
  } >"$DIALPLAN_FILE"
}

include_once() {
  local line=$1 file=$2
  grep -qxF "$line" "$file" || printf '\n%s\n' "$line" >>"$file"
}

reload_all() {
  ast 'module reload res_pjsip.so' >/dev/null
  ast 'module reload res_pjsip_outbound_registration.so' >/dev/null
  ast 'dialplan reload' >/dev/null
}

verify() {
  ast "pjsip show endpoint $LOGIN" | has "Endpoint: +$LOGIN" || { echo "Check failed: endpoint $LOGIN"; return 1; }
  ast 'pjsip show endpoint telnyx' | has 'Endpoint: +telnyx' || { echo 'Check failed: endpoint telnyx'; return 1; }
  ast 'dialplan show 2135550100@from-elevenlabs-us' | has 'telnyx' || { echo 'Check failed: dialing a US business'; return 1; }
  ast "dialplan show $AGENT@plw-us-transfer" | has 'plw-us-ring' || { echo 'Check failed: transfer to Alejandro'; return 1; }
  ast 'dialplan show +12135550100@from-agents' | has 'plw-agents-us' || { echo 'Check failed: agents calling the US'; return 1; }
  ast 'dialplan show 2135550100@plw-agents-us' | has 'telnyx' || { echo 'Check failed: agents calling the US'; return 1; }
  ast 'dialplan show from-agents' | has 'XXXXXXX' || { echo 'Check failed: the existing agent lines'; return 1; }
  local tries
  for tries in 1 2 3 4 5 6; do
    telnyx_registered && return 0
    sleep 5
  done
  echo 'Check failed: Telnyx registration (check the SIP login in the Telnyx portal)'
  return 1
}

restore() {
  local backup=$1
  rm -f "$PJSIP_FILE" "$DIALPLAN_FILE"
  tar -xzf "$backup" -C "$(dirname "$CONF_DIR")"
  reload_all
}

install_telnyx() {
  check_ready

  local user password number
  read -rp 'Telnyx SIP connection username: ' user
  [[ $user =~ ^[A-Za-z0-9_.-]{3,64}$ ]] || die "That username has characters Telnyx doesn't use. Nothing changed."
  read -rsp 'Telnyx SIP connection password (hidden): ' password
  echo
  [[ -n $password && $password != *[[:space:]]* ]] || die "Empty password or one with spaces. Nothing changed."
  read -rp 'US number in Telnyx (+1 and 10 digits, e.g. +12135550100): ' number
  [[ $number =~ ^\+1[2-9][0-9]{2}[2-9][0-9]{6}$ ]] || die "Use +1 and the 10-digit number. Nothing changed."

  local backup
  backup=$BACKUP_DIR/plw-before-telnyx-$(date +%Y%m%d-%H%M%S).tar.gz
  tar --exclude="$(basename "$CONF_DIR")/keys" -czf "$backup" -C "$(dirname "$CONF_DIR")" "$(basename "$CONF_DIR")"
  chmod 600 "$backup"
  echo "Backup: $backup"

  write_pjsip "$user" "$password" "$(openssl rand -hex 24)"
  write_dialplan "$number"
  chown asterisk:asterisk "$PJSIP_FILE" "$DIALPLAN_FILE"
  chmod 640 "$PJSIP_FILE" "$DIALPLAN_FILE"
  include_once '#include pjsip_telnyx.conf' "$CONF_DIR/pjsip.conf"
  include_once '#include extensions_telnyx.conf' "$CONF_DIR/extensions.conf"
  # Telnyx's calls in: only its two US signaling IPs, only SIP.
  if command -v ufw >/dev/null && ufw status | has 'Status: active'; then
    local ip
    for ip in "${TELNYX_IPS[@]}"; do
      ufw allow from "$ip" to any port 5060 proto udp comment 'Telnyx US (plw-telnyx)' >/dev/null
    done
  fi
  reload_all
  sleep 3

  if ! verify; then
    restore "$backup"
    die "A check failed after loading the setup. Everything was put back from $backup."
  fi
  install -m 700 "$0" /usr/local/sbin/plw-telnyx

  cat <<EOF

Installed. Agents can call US numbers, and calls to $number go to the queue.
Vocex, 6199, 6198, the queue, the agents' lines and the dental/tourism route were not touched.
In ElevenLabs > Phone Numbers > Import number > SIP trunk, add $number:
  Label:            PLW EE. UU. (Telnyx)
  Address:          $HOST  (port 5061 if asked)
  Transport:        TLS
  Media encryption: Required
  Username:         $LOGIN
  Password:         on your PC run:  ssh root@207.246.112.58 plw-telnyx password | Set-Clipboard
Then in PLW > Marcador IA > EE. UU., type $number and press Configurar Anna EE. UU.
EOF
}

case ${1:-} in
  install) install_telnyx ;;
  password)
    awk -v login="[$LOGIN]" '$0 == login {s = 1} s && /^password=/ {sub(/^password=/, ""); print; exit}' "$PJSIP_FILE"
    ;;
  rollback)
    [[ -f ${2:-} ]] || die "Name the backup file, for example /root/plw-before-telnyx-....tar.gz"
    restore "$2"
    echo "Put back $2."
    ;;
  *) die "Use: plw-telnyx install | password | rollback BACKUP_FILE" ;;
esac
