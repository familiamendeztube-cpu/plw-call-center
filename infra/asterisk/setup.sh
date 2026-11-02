#!/usr/bin/env bash
# Sets up one Vocex line on an Asterisk 22 LTS server for PLW Call Center.
#
# Run as root on a new Ubuntu 24.04 LTS server:  bash setup.sh
# It asks for the line, the domain and the line password. The password goes
# only into /etc/asterisk/pjsip.conf on the server. Safe to run again until
# plw-agents has added agent logins. After that it refuses to run.
#
# ponytail: one line. Calls only reach a voice echo test until plw-agents.sh
# adds agent logins and call routing. The other lines come later.
set -euo pipefail

readonly ASTERISK_URL=https://downloads.asterisk.org/pub/telephony/asterisk/asterisk-22-current.tar.gz
readonly SIP_SERVER=sip.vocex.net
readonly BROWSER_PORT=8089
readonly RTP_START=10000
readonly RTP_END=20000
readonly CERT_HOOK=/usr/local/bin/asterisk-cert-deploy

die() {
  echo "ERROR: $*" >&2
  exit 1
}

ask_settings() {
  read -rp "Line account number (digits only): " LINE
  [[ $LINE =~ ^[0-9]+$ ]] || die "The line must contain digits only."

  read -rp "Server domain (for example phone.example.com): " DOMAIN
  [[ $DOMAIN =~ ^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || die "That domain doesn't look valid."

  read -rsp "Line password (hidden while you type): " PASSWORD
  echo
  # A ; starts a comment in Asterisk config files and would cut the password short.
  [[ $PASSWORD =~ ^[^\;[:space:]]+$ ]] || die "The password can't be empty or contain spaces or ';'."

  read -rp "Is this line free, with no other phone or business using it? Type yes: " CONFIRM
  [[ $CONFIRM == yes ]] || die "Stopped. Connecting could take calls from a phone already using this line."
}

check_server() {
  [[ $EUID -eq 0 ]] || die "Run this as root."
  # This script replaces pjsip.conf and extensions.conf, which would drop the agents.
  [[ ! -e /etc/asterisk/pjsip_agents.conf ]] ||
    die "This server already has agent logins. Use plw-agents instead."
  # Asterisk 22 failed to compile on Ubuntu 26.04, so stop before a long build.
  grep -q '^VERSION_ID="24.04"' /etc/os-release || die "This script needs Ubuntu 24.04 LTS."

  VOCEX_IP=$(getent ahostsv4 "$SIP_SERVER" | awk 'NR==1 { print $1 }')
  [[ -n $VOCEX_IP ]] || die "Could not find $SIP_SERVER. Check the server's internet connection."

  # WebRTC needs the public IP on the server itself. This also catches DNS that
  # isn't ready and clouds that use NAT, such as AWS and Google Cloud.
  local domain_ip
  domain_ip=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 { print $1 }')
  [[ -n $domain_ip ]] || die "$DOMAIN doesn't point anywhere yet. Add its DNS record, wait, and retry."
  hostname -I | tr ' ' '\n' | grep -qxF "$domain_ip" ||
    die "$DOMAIN points to $domain_ip, which isn't an IP address on this server."
}

install_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get upgrade -y
  apt-get install -y build-essential curl fail2ban certbot ufw
}

setup_firewall() {
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp                      # your login to this server
  ufw allow 80/tcp                      # security certificate renewal
  ufw allow "$BROWSER_PORT/tcp"         # agent browsers
  ufw allow "$RTP_START:$RTP_END/udp"   # call audio
  ufw allow from "$VOCEX_IP" to any port 5060 proto udp
  ufw --force enable
}

install_asterisk() {
  if command -v asterisk >/dev/null && asterisk -V | grep -q 'Asterisk 22\.'; then
    echo "Asterisk 22 is already installed."
    return
  fi

  local src=/usr/local/src/asterisk-22
  mkdir -p "$src"
  curl -fsSL "$ASTERISK_URL" | tar -xz -C "$src" --strip-components=1
  cd "$src"
  export DEBIAN_FRONTEND=noninteractive
  ./contrib/scripts/install_prereq install
  ./configure
  make menuselect.makeopts
  # Cloud servers can move between CPU types, so don't tune the build to this one.
  menuselect/menuselect --disable BUILD_NATIVE menuselect.makeopts
  make -j"$(nproc)"
  make install
  make install-logrotate
  ldconfig
  cd - >/dev/null
}

write_config() {
  local line=$1 password=$2
  id asterisk >/dev/null 2>&1 || useradd --system --home-dir /var/lib/asterisk --shell /usr/sbin/nologin asterisk
  mkdir -p /etc/asterisk/keys

  cat >/etc/asterisk/asterisk.conf <<'EOF'
[options]
runuser = asterisk
rungroup = asterisk
EOF

  cat >/etc/asterisk/modules.conf <<'EOF'
[modules]
autoload=yes
EOF

  cat >/etc/asterisk/logger.conf <<'EOF'
[general]
dateformat=%F %T

[logfiles]
console => notice,warning,error
messages => notice,warning,error
security => security
EOF

  cat >/etc/asterisk/rtp.conf <<EOF
[general]
rtpstart=$RTP_START
rtpend=$RTP_END
EOF

  # Plain HTTP stays private to this server. Browsers connect over TLS only.
  cat >/etc/asterisk/http.conf <<EOF
[general]
enabled=yes
bindaddr=127.0.0.1
bindport=8088
tlsenable=yes
tlsbindaddr=0.0.0.0:$BROWSER_PORT
tlscertfile=/etc/asterisk/keys/asterisk.crt
tlsprivatekey=/etc/asterisk/keys/asterisk.key
EOF

  cat >/etc/asterisk/pjsip.conf <<EOF
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060

[transport-wss]
type=transport
protocol=wss
bind=0.0.0.0

[vocex]
type=registration
transport=transport-udp
outbound_auth=vocex
server_uri=sip:$SIP_SERVER
client_uri=sip:$line@$SIP_SERVER
contact_user=$line
retry_interval=60
; The default of 10 gives up for good after a short outage.
max_retries=100000

[vocex]
type=auth
auth_type=userpass
username=$line
password=$password

[vocex]
type=aor
contact=sip:$SIP_SERVER:5060

[vocex]
type=endpoint
transport=transport-udp
context=from-vocex
disallow=all
allow=alaw,ulaw
outbound_auth=vocex
aors=vocex
from_user=$line
from_domain=$SIP_SERVER
direct_media=no

[vocex]
type=identify
endpoint=vocex
match=$SIP_SERVER
EOF

  # This is the whole dialplan: incoming calls can only reach the echo test,
  # so nothing that arrives here can place a billable outgoing call.
  cat >/etc/asterisk/extensions.conf <<'EOF'
[from-vocex]
exten => _X.,1,Goto(s,1)
exten => s,1,Answer()
 same => n,Wait(1)
 same => n,Playback(hello-world)
 same => n,Echo()
 same => n,Hangup()
EOF

  chown -R asterisk:asterisk /etc/asterisk /var/lib/asterisk /var/log/asterisk /var/spool/asterisk
  chmod 750 /etc/asterisk /etc/asterisk/keys
  chmod 640 /etc/asterisk/*.conf
}

setup_certificate() {
  local domain=$1
  cat >"$CERT_HOOK" <<EOF
#!/bin/sh
set -e
install -o asterisk -g asterisk -m 640 /etc/letsencrypt/live/$domain/fullchain.pem /etc/asterisk/keys/asterisk.crt
install -o asterisk -g asterisk -m 640 /etc/letsencrypt/live/$domain/privkey.pem /etc/asterisk/keys/asterisk.key
# Reloads the certificate without dropping calls in progress.
if systemctl is-active --quiet asterisk; then asterisk -rx 'module reload http'; fi
EOF
  chmod 755 "$CERT_HOOK"
  certbot certonly --standalone --non-interactive --agree-tos --keep-until-expiring \
    --register-unsafely-without-email --deploy-hook "$CERT_HOOK" -d "$domain"
  "$CERT_HOOK"
}

setup_fail2ban() {
  cat >/etc/fail2ban/jail.d/asterisk.local <<EOF
[asterisk]
enabled = true
backend = auto
port = $BROWSER_PORT
logpath = /var/log/asterisk/security
maxretry = 5
bantime = 1h
EOF
  touch /var/log/asterisk/security
  chown asterisk:asterisk /var/log/asterisk/security
  systemctl enable fail2ban
  systemctl restart fail2ban
}

start_asterisk() {
  cat >/etc/systemd/system/asterisk.service <<'EOF'
[Unit]
Description=Asterisk
After=network-online.target
Wants=network-online.target

[Service]
User=asterisk
Group=asterisk
RuntimeDirectory=asterisk
ExecStart=/usr/sbin/asterisk -f -C /etc/asterisk/asterisk.conf
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable asterisk
  systemctl restart asterisk
}

report_status() {
  local status=''
  for _ in {1..30}; do
    sleep 2
    status=$(asterisk -rx 'pjsip show registrations' 2>/dev/null || true)
    # Only success ends the wait: "Rejected" can also be a temporary failure.
    grep -q 'Registered' <<<"$status" && break
  done

  echo
  echo "$status"
  echo
  if grep -q 'Registered' <<<"$status"; then
    cat <<EOF
Setup finished. The line is connected to Vocex.

Test 1, call out. Replace the number with a mobile phone you have with you:
  asterisk -rx 'channel originate PJSIP/88888888@vocex application Echo'
Answer it and talk. You should hear your own voice. If the call fails,
try the number with 506 in front.

Test 2, call in. Call $LINE from that mobile. You should hear a short
greeting in English, then your own voice.
EOF
  else
    cat <<EOF
Setup finished, but the line did NOT connect to Vocex.
Check the line number and password, and ask Vocex whether they allow this
server's IP address. Then run this script again. It won't rebuild Asterisk.
Details:
  tail -n 40 /var/log/asterisk/messages
EOF
    exit 1
  fi
}

main() {
  ask_settings
  check_server
  install_packages
  setup_firewall
  install_asterisk
  write_config "$LINE" "$PASSWORD"
  setup_certificate "$DOMAIN"
  setup_fail2ban
  start_asterisk
  report_status
}

# Lets the test harness load these functions without running the setup.
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main
fi
