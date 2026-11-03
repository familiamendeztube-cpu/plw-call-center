#!/usr/bin/env bash
# Manages browser phone logins on the running PLW Asterisk server.
# Use this on a working server. Running setup.sh again would overwrite it.
#
#   plw-agents setup agent-1 [agent-2 ...]   Adds logins. Incoming calls ring the first one.
#   plw-agents password agent-1              Sends a password into a pipe, never to a screen.
#   plw-agents rotate agent-1                Replaces a password.
#   plw-agents rollback BACKUP_FILE          Puts a backup back.
#
# Every change makes a backup first, and setup puts it back by itself if the
# Vocex line or the new logins don't check out afterwards. This script never
# reads or prints the Vocex password.
#
# Set VOCEX_PREFIX=506 for setup if Vocex needs 506 in front of Costa Rican numbers.
#
# ponytail: one agent receives every incoming call. Queues and rotation come
# when more than one agent takes calls.
set -euo pipefail
umask 027

readonly CONF_DIR=${PLW_CONF_DIR:-/etc/asterisk}
readonly BACKUP_DIR=${PLW_BACKUP_DIR:-/root}
readonly AGENTS_CONF=$CONF_DIR/pjsip_agents.conf
readonly INCLUDE_LINE='#include pjsip_agents.conf'
readonly VOCEX_PREFIX=${VOCEX_PREFIX:-}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

check_agent_name() {
  [[ $1 =~ ^agent-[0-9]+$ ]] || die "'$1' isn't an agent login. Use a name like agent-1."
}

agent_exists() {
  [[ -f $AGENTS_CONF ]] && grep -qxF "[$1]" "$AGENTS_CONF"
}

trunk_registered() {
  # Only "Registered" counts: the check is case-sensitive, so "Unregistered" fails it.
  grep -q 'Registered' <<<"$(asterisk -rx 'pjsip show registrations')"
}

wait_for_trunk() {
  for _ in {1..15}; do
    trunk_registered && return 0
    sleep 2
  done
  return 1
}

check_root() {
  [[ $EUID -eq 0 ]] || die "Run this as root."
}

check_server() {
  check_root
  [[ $VOCEX_PREFIX =~ ^[0-9]*$ ]] || die "VOCEX_PREFIX can contain digits only."
  grep -qx 'context=from-vocex' "$CONF_DIR/pjsip.conf" ||
    die "The Vocex settings in pjsip.conf aren't in the expected form. Nothing was changed."
  trunk_registered || die "The Vocex line isn't registered right now. Nothing was changed."

  local module
  for module in res_srtp res_http_websocket res_pjsip_transport_websocket; do
    grep -q "$module.so" <<<"$(asterisk -rx "module show like $module")" ||
      die "Asterisk module $module isn't loaded, so browser calls can't work. Nothing was changed."
  done
}

backup_config() {
  BACKUP=$BACKUP_DIR/asterisk-backup-$(date +%Y%m%d-%H%M%S).tar.gz
  local conf_name
  conf_name=$(basename "$CONF_DIR")
  # It holds the Vocex password, so only root may read it. The certificate stays
  # out: certbot manages it, and restoring an old one could undo a renewal.
  (umask 077 && tar -C "$(dirname "$CONF_DIR")" --exclude="$conf_name/keys" -czf "$BACKUP" "$conf_name")
  echo "Backup saved: $BACKUP"
}

reload_asterisk() {
  chown asterisk:asterisk "$AGENTS_CONF" "$CONF_DIR/pjsip.conf" "$CONF_DIR/extensions.conf"
  chmod 640 "$AGENTS_CONF" "$CONF_DIR/pjsip.conf" "$CONF_DIR/extensions.conf"
  asterisk -rx 'module reload res_pjsip.so' >/dev/null
  asterisk -rx 'dialplan reload' >/dev/null
}

restore_backup() {
  local backup=$1
  [[ -f $backup ]] || die "There is no backup at $backup."
  # A backup from before the first setup has no agents file, so clear the current one.
  rm -f "$AGENTS_CONF"
  tar -C "$(dirname "$CONF_DIR")" -xzf "$backup"
  asterisk -rx 'module reload res_pjsip.so' >/dev/null
  asterisk -rx 'dialplan reload' >/dev/null
}

add_agent() {
  local agent=$1
  agent_exists "$agent" && return
  cat >>"$AGENTS_CONF" <<EOF

[$agent]
type=aor
; One browser per login. The newest one takes over from the previous one.
max_contacts=1
remove_existing=yes

[$agent]
type=auth
auth_type=userpass
username=$agent
password=$(openssl rand -hex 16)

[$agent]
type=endpoint
aors=$agent
auth=$agent
context=from-agents
webrtc=yes
dtls_auto_generate_cert=yes
; The same codecs as Vocex, so Asterisk doesn't have to convert the audio.
disallow=all
allow=alaw,ulaw
direct_media=no
; Ends the call if the browser disappears, so a dead tab can't keep a paid call open.
rtp_timeout=30
allow_overlap=no
allow_transfer=no
allow_subscribe=no
EOF
}

include_agents() {
  grep -qxF "$INCLUDE_LINE" "$CONF_DIR/pjsip.conf" ||
    printf '\n%s\n' "$INCLUDE_LINE" >>"$CONF_DIR/pjsip.conf"
}

# The Vocex endpoint has no inbound password, and the browser port is open to
# the internet. Without this, a client calling itself "vocex" would be accepted
# as Vocex. Real Vocex calls already match by IP, so they aren't affected.
lock_trunk_to_ip() {
  grep -qx 'identify_by=ip' "$CONF_DIR/pjsip.conf" && return
  sed -i '/^context=from-vocex$/a identify_by=ip' "$CONF_DIR/pjsip.conf"
}

write_dialplan() {
  local inbound_agent=$1
  cat >"$CONF_DIR/extensions.conf" <<EOF
[globals]
INBOUND_AGENT=$inbound_agent
RING_SECONDS=25
VOCEX_PREFIX=$VOCEX_PREFIX

EOF
  # Calls from Vocex can only ring the agent, and agents can only reach Costa
  # Rican numbers, so nothing that arrives from outside can place a paid call.
  cat >>"$CONF_DIR/extensions.conf" <<'EOF'
; Unanswered calls are refused, not answered. The caller hears the carrier's
; own busy or unavailable tone in their language and isn't billed.
; 17 sends "486 Busy", 19 sends "480 Unavailable".
[from-vocex]
exten => _X.,1,Goto(s,1)
exten => s,1,Dial(PJSIP/${INBOUND_AGENT},${RING_SECONDS})
 same => n,Hangup(${IF($["${DIALSTATUS}" = "BUSY"]?17:19)})

; Eight digits starting with 2-8, with or without 506. This keeps out 800, 900
; and 905 numbers, which have ten digits, short codes such as 911, and
; international calls. 21 sends "403 Forbidden".
[from-agents]
exten => _[2-8]XXXXXXX,1,Dial(PJSIP/${VOCEX_PREFIX}${EXTEN}@vocex,60)
exten => _506[2-8]XXXXXXX,1,Dial(PJSIP/${VOCEX_PREFIX}${EXTEN:3}@vocex,60)
exten => _X.,1,Hangup(21)
EOF
}

check_result() {
  local agent
  for agent in "$@"; do
    grep -q "Endpoint: *$agent" <<<"$(asterisk -rx "pjsip show endpoint $agent")" || return 1
  done
  grep -q 'XXXXXXX' <<<"$(asterisk -rx 'dialplan show from-agents')" || return 1
  grep -q 'ip' <<<"$(asterisk -rx 'pjsip show endpoint vocex' | grep identify_by)" || return 1
  wait_for_trunk
}

setup_agents() {
  [[ $# -ge 1 ]] || die "Name at least one agent, for example: plw-agents setup agent-1"
  local agent
  for agent in "$@"; do check_agent_name "$agent"; done
  if [[ -f /etc/plw-bridge.env ]]; then
    die "Queue bridge is installed. setup would overwrite routing; use the bridge runbook to add agents."
  fi
  check_server
  backup_config

  for agent in "$@"; do add_agent "$agent"; done
  include_agents
  lock_trunk_to_ip
  write_dialplan "$1"
  reload_asterisk

  if ! check_result "$@"; then
    restore_backup "$BACKUP"
    die "The check after the change failed, so the backup was put back. Details: tail -n 40 /var/log/asterisk/messages"
  fi
  echo "Done. Vocex is still registered, and incoming calls ring $1."
}

show_password() {
  check_root
  check_agent_name "$1"
  [[ ! -t 1 ]] || die "Passwords don't go on screen. Pipe this command, as the README shows."
  local password
  password=$(sed -n "/^username=$1\$/{n;s/^password=//p}" "$AGENTS_CONF")
  [[ -n $password ]] || die "There is no login called $1."
  printf '%s' "$password"
}

rotate_password() {
  check_root
  check_agent_name "$1"
  agent_exists "$1" || die "There is no login called $1."
  backup_config
  sed -i "/^username=$1\$/{n;s/^password=.*/password=$(openssl rand -hex 16)/}" "$AGENTS_CONF"
  reload_asterisk
  echo "Done. Enter the new password in the app, as the README shows. Calls stop working until then."
}

rollback() {
  check_root
  [[ $# -eq 1 ]] || die "Name the backup file, for example: plw-agents rollback $BACKUP_DIR/asterisk-backup-...tar.gz"
  restore_backup "$1"
  wait_for_trunk || die "The backup was put back, but Vocex isn't registered yet."
  echo "Done. The backup is back in place and Vocex is registered."
}

main() {
  local command=${1:-}
  shift || true
  case $command in
    setup) setup_agents "$@" ;;
    password) show_password "${1:-}" ;;
    rotate) rotate_password "${1:-}" ;;
    rollback) rollback "$@" ;;
    *) die "Use one of: setup, password, rotate, rollback." ;;
  esac
}

# Lets the test harness load these functions without running anything.
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
