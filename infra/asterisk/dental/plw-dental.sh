#!/usr/bin/env bash
# Routes Anna's (ElevenLabs) dental calls through this Asterisk on 4010 6198, so Asterisk,
# not Vocex, carries out her transfers to the agents' browser phones. Vocex refuses
# transfers itself (403 to this server, 486 to 4010 6199).
#   plw-dental install          Adds the setup. Asks for the Vocex password of 6198.
#   plw-dental password         Prints only ElevenLabs' login password, for a pipe.
#   plw-dental rollback FILE    Puts a backup back.
# Nothing existing is edited: 6199, the queue, the agents and the AI overflow stay as they
# are. Everything lives in pjsip_dental.conf and extensions_dental.conf, included at the end
# of the main files. 6198 is NOT registered here, so its incoming calls stay wherever Vocex
# sends them (the PLW agent in ElevenLabs today).
set -euo pipefail
umask 027

readonly CONF_DIR=${PLW_CONF_DIR:-/etc/asterisk}
readonly BACKUP_DIR=${PLW_BACKUP_DIR:-/root}
readonly PJSIP_FILE=$CONF_DIR/pjsip_dental.conf
readonly DIALPLAN_FILE=$CONF_DIR/extensions_dental.conf
readonly HOST=phone.professionallatinoworkers.com
readonly LOGIN=plw-dental-dialer
readonly LINE=50640106198
readonly AGENTS=(agent-2 agent-3) # Alejandro, Valeska: the agents dental leads belong to.

die() {
  echo "ERROR: $*" >&2
  exit 1
}

ast() { asterisk -rx "$1"; }

# Reads all of its input (unlike grep -q), so "pipefail" can't fail on a closed pipe.
has() { grep -E "$1" >/dev/null; }

line_registered() { ast 'pjsip show registrations' | has 'Registered'; }

check_ready() {
  [[ $EUID -eq 0 ]] || die "Run as root."
  [[ ! -e $PJSIP_FILE && ! -e $DIALPLAN_FILE ]] ||
    die "Already installed. Use 'plw-dental rollback BACKUP' first to reinstall. Nothing changed."
  grep -q '^\[transport-elevenlabs-tls\]' "$CONF_DIR/pjsip_elevenlabs.conf" ||
    die "The ElevenLabs TLS transport is missing. Nothing changed."
  grep -q '^\[from-agents\]' "$CONF_DIR/extensions.conf" ||
    die "The expected dialplan is missing. Nothing changed."
  local agent
  for agent in "${AGENTS[@]}"; do
    grep -qxF "[$agent]" "$CONF_DIR/pjsip_agents.conf" ||
      die "Agent login $agent is missing. Nothing changed."
  done
  line_registered || die "4010 6199 is not registered with Vocex right now. Nothing changed."
  # ElevenLabs connects to this server over TLS and checks the certificate.
  local cert
  cert=$(awk -F= '/^cert_file=/{print $2; exit}' "$CONF_DIR/pjsip_elevenlabs.conf")
  openssl x509 -in "$cert" -noout -checkend 1209600 >/dev/null ||
    die "The TLS certificate $cert is unreadable or expires within 14 days. Nothing changed."
  openssl x509 -in "$cert" -noout -ext subjectAltName 2>/dev/null | has "DNS:$HOST" ||
    die "The TLS certificate is not issued for $HOST. Nothing changed."
}

# ElevenLabs puts the phone number, not its login, in From, so Asterisk must recognise it
# by the login it answers the challenge with.
needs_auth_username() {
  ! ast 'pjsip show settings' | grep -i 'endpoint_identifier_order' | has 'auth_username'
}

write_pjsip() {
  local vocex_password=${1//;/\\;} login_password=$2 add_global=$3
  {
    echo '; PLW dental dialer, written by plw-dental. See infra/asterisk/dental in the repo.'
    if [[ $add_global == yes ]]; then
      cat <<'EOF'

; Adds auth_username after the default identifiers, so nothing already working changes.
[global]
type=global
endpoint_identifier_order=ip,username,anonymous,header,auth_username
EOF
    fi
    cat <<EOF

[$LOGIN]
type=auth
auth_type=userpass
username=$LOGIN
password=$login_password

; Anna's calls from ElevenLabs: recognised only by this login, never by From or IP.
[$LOGIN]
type=endpoint
transport=transport-elevenlabs-tls
identify_by=auth_username
auth=$LOGIN
context=from-elevenlabs-dialer
disallow=all
allow=ulaw,alaw
media_encryption=sdes
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
allow_transfer=yes
allow_subscribe=no

[vocex-6198]
type=auth
auth_type=userpass
username=$LINE
password=$vocex_password

[vocex-6198]
type=aor
contact=sip:sip.vocex.net:5060

; Outgoing only. identify_by=ip without an identify section: nothing can arrive on it, and
; Vocex's own calls keep matching the existing vocex endpoint.
[vocex-6198]
type=endpoint
transport=transport-udp
identify_by=ip
context=plw-dental-deny
disallow=all
allow=alaw,ulaw
outbound_auth=vocex-6198
aors=vocex-6198
from_user=$LINE
from_domain=sip.vocex.net
direct_media=no
EOF
  } >"$PJSIP_FILE"
}

write_dialplan() {
  {
    echo '; PLW dental dialer, written by plw-dental. See infra/asterisk/dental in the repo.'
    cat <<'EOF'

; Anna calling a dentist on 4010 6198. Eight-digit Costa Rican numbers only, with or
; without 506, the same rule the agents have, so nothing else can be dialed through here.
; TRANSFER_CONTEXT makes Asterisk carry out her transfers in plw-dental-transfer.
[from-elevenlabs-dialer]
exten => _+506[2-8]XXXXXXX,1,Goto(${EXTEN:4},1)
exten => _506[2-8]XXXXXXX,1,Goto(${EXTEN:3},1)
exten => _[2-8]XXXXXXX,1,Set(TRANSFER_CONTEXT=plw-dental-transfer)
 same => n,Set(__PLW_DENTIST=${EXTEN})
 same => n,Dial(PJSIP/${VOCEX_PREFIX}${EXTEN}@vocex-6198,60)
 same => n,Hangup()
exten => _X.,1,Hangup(21)
exten => _+X.,1,Hangup(21)

; Anna hands an interested dentist to the lead's agent. Only the agents' browser logins can
; be reached, so a transfer can never become a paid call. Exact names on purpose: in a
; pattern the "n" of "agent" would be a wildcard.
[plw-dental-transfer]
EOF
    local agent
    for agent in "${AGENTS[@]}"; do
      printf 'exten => %s,1,Gosub(plw-dental-ring,s,1(%s))\n same => n,Hangup()\n' "$agent" "$agent"
    done
    cat <<'EOF'

; Runs on the dentist's call. The agent sees the dentist's number. If that agent is busy or
; doesn't answer in 25 s, the call center queue tries everyone, then the AI receptionist,
; exactly like a call to 4010 6199.
[plw-dental-ring]
exten => s,1,Set(CALLERID(all)=Dentista <${PLW_DENTIST}>)
 same => n,Dial(PJSIP/${ARG1},25,r)
 same => n,GotoIf($["${DIALSTATUS}" = "ANSWER"]?done)
 same => n,Queue(plw-inbound,,,,30)
 same => n,GotoIf($["${QUEUESTATUS}" = "JOINEMPTY"]?ai)
 same => n,GotoIf($["${QUEUESTATUS}" = "LEAVEEMPTY"]?ai)
 same => n,GotoIf($["${QUEUESTATUS}" = "JOINUNAVAIL"]?ai)
 same => n,GotoIf($["${QUEUESTATUS}" = "LEAVEUNAVAIL"]?ai)
 same => n,GotoIf($["${QUEUESTATUS}" = "TIMEOUT"]?ai)
 same => n,GotoIf($["${QUEUESTATUS}" = "FULL"]?ai)
 same => n(done),Return()
 same => n(ai),Dial(PJSIP/elevenlabs-overflow,45)
 same => n,Return()

[plw-dental-deny]
exten => _X.,1,Hangup(21)
exten => s,1,Hangup(21)
EOF
  } >"$DIALPLAN_FILE"
}

include_once() {
  local line=$1 file=$2
  grep -qxF "$line" "$file" || printf '\n%s\n' "$line" >>"$file"
}

reload_all() {
  ast 'module reload res_pjsip.so' >/dev/null
  ast 'dialplan reload' >/dev/null
}

verify() {
  ast "pjsip show endpoint $LOGIN" | has "Endpoint: +$LOGIN" || { echo "Check failed: endpoint $LOGIN"; return 1; }
  ast 'pjsip show endpoint vocex-6198' | has 'Endpoint: +vocex-6198' || { echo 'Check failed: endpoint vocex-6198'; return 1; }
  ast 'dialplan show 22223333@from-elevenlabs-dialer' | has 'vocex-6198' || { echo 'Check failed: dialing a dentist'; return 1; }
  ast "dialplan show ${AGENTS[0]}@plw-dental-transfer" | has 'plw-dental-ring' || { echo 'Check failed: transfer to an agent'; return 1; }
  ! needs_auth_username || { echo 'Check failed: login-based recognition (auth_username)'; return 1; }
  line_registered || { echo 'Check failed: 4010 6199 registration'; return 1; }
}

restore() {
  local backup=$1
  rm -f "$PJSIP_FILE" "$DIALPLAN_FILE"
  tar -xzf "$backup" -C "$(dirname "$CONF_DIR")"
  reload_all
}

install_dental() {
  check_ready
  local add_global=no
  if needs_auth_username; then
    ! grep -qs '^type=global' "$CONF_DIR"/pjsip*.conf ||
      die "pjsip already has a [global] section. Add auth_username to its endpoint_identifier_order by hand first. Nothing changed."
    add_global=yes
  fi

  local vocex_password
  read -rsp 'Vocex password for 4010 6198 (hidden): ' vocex_password
  echo
  [[ -n $vocex_password && $vocex_password != *[[:space:]]* ]] ||
    die "Empty password or one with spaces. Nothing changed."

  local backup
  backup=$BACKUP_DIR/plw-before-dental-$(date +%Y%m%d-%H%M%S).tar.gz
  tar --exclude="$(basename "$CONF_DIR")/keys" -czf "$backup" -C "$(dirname "$CONF_DIR")" "$(basename "$CONF_DIR")"
  chmod 600 "$backup"
  echo "Backup: $backup"

  write_pjsip "$vocex_password" "$(openssl rand -hex 24)" "$add_global"
  write_dialplan
  chown asterisk:asterisk "$PJSIP_FILE" "$DIALPLAN_FILE"
  chmod 640 "$PJSIP_FILE" "$DIALPLAN_FILE"
  include_once '#include pjsip_dental.conf' "$CONF_DIR/pjsip.conf"
  include_once '#include extensions_dental.conf' "$CONF_DIR/extensions.conf"
  reload_all
  sleep 3

  if ! verify; then
    restore "$backup"
    die "A check failed after loading the setup. Everything was put back from $backup."
  fi
  install -m 700 "$0" /usr/local/sbin/plw-dental
  # ElevenLabs connects in on 5061 (TLS). Only the login above is accepted there, and
  # fail2ban's Asterisk jail bans on the browser port, so it can't cut Anna off.
  if command -v ufw >/dev/null && ufw status | has 'Status: active' && ! ufw status | has '^5061/tcp'; then
    ufw allow 5061/tcp comment 'ElevenLabs Anna (plw-dental)' >/dev/null
  fi

  cat <<EOF

Installed. 4010 6199, the queue, the agents and the AI overflow were not touched.
In ElevenLabs > Phone Numbers > +506 4010 6198 > Outbound, set:
  Address:          $HOST  (port 5061 if asked)
  Transport:        TLS
  Media encryption: Required
  Username:         $LOGIN
  Password:         on your PC run:  ssh root@207.246.112.58 plw-dental password | Set-Clipboard
To undo, put back Address sip.vocex.net, TCP, Disabled, user $LINE and its Vocex password.
EOF
}

case ${1:-} in
  install) install_dental ;;
  password)
    awk -v login="[$LOGIN]" '$0 == login {s = 1} s && /^password=/ {sub(/^password=/, ""); print; exit}' "$PJSIP_FILE"
    ;;
  rollback)
    [[ -f ${2:-} ]] || die "Name the backup file, for example /root/plw-before-dental-....tar.gz"
    restore "$2"
    echo "Put back $2."
    ;;
  *) die "Use: plw-dental install | password | rollback BACKUP_FILE" ;;
esac
