#!/usr/bin/env bash
# ============================================================================
#  PicoMeet installer v1.1 — Ubuntu 22.04 / 24.04
#  Interactive:   sudo bash install.sh
#  Unattended:    sudo bash install.sh -d meet.example.com -e you@mail.com \
#                    -u admin -p 'S3cretPass!' --with-turn
# ============================================================================
set -Eeuo pipefail
APP=picomeet
APP_DIR=/opt/$APP
APP_USER=$APP
NODE_MAJOR=20
REPO_URL="${PM_REPO:-https://github.com/migandhi/picomeet.git}"
DOMAIN=""; EMAIL=""; ADMIN_USER="admin"; ADMIN_PASS=""; WITH_TURN=0; NO_TLS=0; BRANCH=main
C_G='\033[1;32m'; C_Y='\033[1;33m'; C_R='\033[1;31m'; C_B='\033[1;36m'; C_0='\033[0m'
say()  { echo -e "${C_G}==>${C_0} $*"; }
warn() { echo -e "${C_Y}[!]${C_0} $*"; }
die()  { echo -e "${C_R}[x]${C_0} $*" >&2; exit 1; }
trap 'die "Failed on line $LINENO. Fix and re-run — the script is idempotent."' ERR
# ------------------------------- arguments ---------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--domain)  DOMAIN="$2"; shift 2;;
    -e|--email)   EMAIL="$2"; shift 2;;
    -u|--user)    ADMIN_USER="$2"; shift 2;;
    -p|--pass)    ADMIN_PASS="$2"; shift 2;;
    -b|--branch)  BRANCH="$2"; shift 2;;
    --with-turn)  WITH_TURN=1; shift;;
    --no-tls)     NO_TLS=1; shift;;
    -h|--help)    grep '^#' "$0" | head -8; exit 0;;
    *) die "Unknown option: $1";;
  esac
done
[[ $EUID -eq 0 ]] || die "Run me with sudo:  sudo bash install.sh"
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || warn "Tested on Ubuntu 22.04/24.04 — continuing anyway."
echo -e "${C_B}
   ___  _         __  __         _
  / _ \(_)__ ___ /  \/  |___ ___| |_
 / ___/ / _/ _ \ /\/\  / -_) -_)  _|
/_/  /_/\__\___/_/  \/\___\___|\__|   installer v1.1
${C_0}"
# ------------------------------ interactive --------------------------------
if [[ -z "$DOMAIN" ]]; then
  echo "Point an A record at this server first (any registrar; see README → DNS)."
  read -rp "Your domain or subdomain (e.g. meet.myschool.com): " DOMAIN
fi
[[ -n "$DOMAIN" ]] || die "A domain is required. WebRTC needs HTTPS, HTTPS needs a domain."
if [[ -z "$EMAIL" && $NO_TLS -eq 0 ]]; then
  read -rp "Email for Let's Encrypt expiry notices (blank = skip): " EMAIL
fi
if [[ -z "$ADMIN_PASS" ]]; then
  read -rsp "Choose an admin password (8+ chars): " ADMIN_PASS; echo
fi
[[ ${#ADMIN_PASS} -ge 8 ]] || die "Admin password must be at least 8 characters."
# --------------------------- DNS sanity check ------------------------------
say "Checking DNS for $DOMAIN ..."
MYIP=$(curl -fsS --max-time 8 https://api.ipify.org || echo "")
DNSIP=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || echo "")
if [[ -n "$MYIP" && -n "$DNSIP" && "$MYIP" != "$DNSIP" ]]; then
  warn "$DOMAIN resolves to $DNSIP but this server is $MYIP."
  warn "Certificate issuance will fail until DNS propagates."
  read -rp "Continue anyway? [y/N] " a; [[ "${a,,}" == "y" ]] || exit 1
elif [[ -z "$DNSIP" ]]; then
  warn "$DOMAIN does not resolve yet. Continuing — Caddy will retry automatically."
fi
# ------------------------------- swap file ---------------------------------
RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
if [[ $RAM_MB -lt 2048 && ! -f /swapfile ]]; then
  say "Only ${RAM_MB}MB RAM detected — creating a 2 GB swap file (safety net)."
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile; mkswap -q /swapfile; swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -qw vm.swappiness=10
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi
# ------------------------------ base packages ------------------------------
say "Installing base packages ..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git ufw build-essential python3 \
                       debian-keyring debian-archive-keyring apt-transport-https \
                       sqlite3 unattended-upgrades >/dev/null
# --------------------- automatic OS security patching ----------------------
say "Enabling unattended security upgrades (long-term hands-off operation) ..."
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
# --------------------------------- Node.js ---------------------------------
if ! command -v node >/dev/null || [[ $(node -v | cut -c2- | cut -d. -f1) -lt 18 ]]; then
  say "Installing Node.js ${NODE_MAJOR}.x ..."
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq && apt-get install -y -qq nodejs >/dev/null
fi
say "Node $(node -v)"
# ---------------------------------- Caddy ----------------------------------
if ! command -v caddy >/dev/null; then
  say "Installing Caddy (automatic HTTPS, ~25 MB RAM) ..."
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
# ------------------------------ fetch the app ------------------------------
say "Installing PicoMeet into $APP_DIR ..."
id -u "$APP_USER" &>/dev/null || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$APP_DIR"
if [[ -f "$SRC_DIR/package.json" && -d "$SRC_DIR/server" ]]; then
  say "Using local source at $SRC_DIR"
  cp -a "$SRC_DIR/." "$APP_DIR/"
else
  say "Cloning $REPO_URL ($BRANCH)"
  rm -rf /tmp/$APP-src && git clone --depth 1 -b "$BRANCH" "$REPO_URL" /tmp/$APP-src
  cp -a /tmp/$APP-src/. "$APP_DIR/"
fi
mkdir -p "$APP_DIR/data"
cd "$APP_DIR"
say "Installing npm dependencies (2 packages) ..."
npm install --omit=dev --no-audit --no-fund --loglevel=error
# --------------------------------- .env ------------------------------------
if [[ ! -f "$APP_DIR/.env" ]]; then
  SECRET=$(openssl rand -hex 32)
  TURN_SECRET=$(openssl rand -hex 24)
  SCHEME="https"; [[ $NO_TLS -eq 1 ]] && SCHEME="http"
  # v1.1: advertise TURN over UDP *and* TCP so users behind UDP-blocking
  # firewalls (offices, hotels, campuses) can still connect.
  TURN_URLS=""
  [[ $WITH_TURN -eq 1 ]] && TURN_URLS="turn:${DOMAIN}:3478?transport=udp,turn:${DOMAIN}:3478?transport=tcp"
  cat > "$APP_DIR/.env" <<EOF
PM_PORT=8080
PM_HOST=127.0.0.1
PM_PUBLIC_URL=${SCHEME}://${DOMAIN}
PM_DB=./data/picomeet.db
PM_SECRET=${SECRET}
PM_SESSION_DAYS=14
# Safety caps for a 1 GB / 1 vCPU droplet — raise only after load-testing.
PM_MAX_CONCURRENT_MEETINGS=8
PM_MAX_TOTAL_PARTICIPANTS=60
PM_MAX_ROOM_PARTICIPANTS=12
PM_LECTURE_THRESHOLD=9
PM_MAX_STAGE=4
PM_STUN=stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478
PM_TURN_URL=${TURN_URLS}
PM_TURN_SECRET=$( [[ $WITH_TURN -eq 1 ]] && echo "${TURN_SECRET}" )
PM_TURN_TTL=7200
PM_SFU_URL=
EOF
  chmod 600 "$APP_DIR/.env"
else
  warn ".env already exists — leaving it untouched."
  TURN_SECRET=$(grep -E '^PM_TURN_SECRET=' "$APP_DIR/.env" | cut -d= -f2- || true)
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
# ------------------------------ admin account ------------------------------
say "Creating admin account '$ADMIN_USER' ..."
sudo -u "$APP_USER" node "$APP_DIR/server/cli.js" create-admin "$ADMIN_USER" "$ADMIN_PASS" \
  || warn "Admin may already exist — use 'picomeet passwd' to reset."
# -------------------------------- systemd ----------------------------------
say "Writing systemd unit ..."
cat > /etc/systemd/system/$APP.service <<EOF
[Unit]
Description=PicoMeet signalling + web server
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/node --max-old-space-size=192 $APP_DIR/server/index.js
Restart=always
RestartSec=3
MemoryMax=420M
MemoryHigh=340M
TasksMax=256
LimitNOFILE=8192
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
ReadWritePaths=$APP_DIR/data
StandardOutput=append:/var/log/$APP.log
StandardError=append:/var/log/$APP.log
[Install]
WantedBy=multi-user.target
EOF
touch /var/log/$APP.log && chown $APP_USER:$APP_USER /var/log/$APP.log
cat > /etc/logrotate.d/$APP <<EOF
/var/log/$APP.log { weekly rotate 4 compress missingok notifempty copytruncate }
EOF
systemctl daemon-reload
systemctl enable --now $APP >/dev/null
# --------------------------------- Caddy -----------------------------------
say "Configuring Caddy for https://$DOMAIN ..."
if [[ $NO_TLS -eq 1 ]]; then SITE=":80"; else SITE="$DOMAIN"; fi
cat > /etc/caddy/Caddyfile <<EOF
{
$( [[ -n "$EMAIL" ]] && echo "    email $EMAIL" )
    servers { timeouts { read_body 10s idle 10m } }
}
$SITE {
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options    "nosniff"
        X-Frame-Options           "SAMEORIGIN"
        Referrer-Policy           "strict-origin-when-cross-origin"
        Permissions-Policy        "camera=(self), microphone=(self), display-capture=(self), geolocation=()"
        -Server
    }
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1
        header_up X-Forwarded-For {remote_host}
    }
}
EOF
systemctl reload caddy 2>/dev/null || systemctl restart caddy
# --------------------------------- coturn ----------------------------------
if [[ $WITH_TURN -eq 1 ]]; then
  say "Installing coturn (TURN relay — the firewall-buster) ..."
  apt-get install -y -qq coturn >/dev/null
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  cat > /etc/turnserver.conf <<EOF
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=${TURN_SECRET}
realm=${DOMAIN}
no-cli
no-multicast-peers
min-port=49160
max-port=49200
# ---- bandwidth protection: TURN traffic DOES count against your 1 TB ----
user-quota=12
total-quota=60
max-bps=600000
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
EOF
  systemctl enable --now coturn >/dev/null
  warn "TURN relays media THROUGH this droplet: ~0.5 GB per relayed participant-hour."
fi
# --------------------------------- firewall --------------------------------
say "Configuring firewall ..."
ufw allow OpenSSH >/dev/null
ufw allow 80,443/tcp >/dev/null
if [[ $WITH_TURN -eq 1 ]]; then
  ufw allow 3478/tcp >/dev/null; ufw allow 3478/udp >/dev/null
  ufw allow 5349/tcp >/dev/null; ufw allow 49160:49200/udp >/dev/null
fi
ufw --force enable >/dev/null
# ------------------------------ daily backup -------------------------------
say "Scheduling daily database backup (03:17, keeps last 7) ..."
chmod +x $APP_DIR/ops/backup.sh 2>/dev/null || true
( crontab -l 2>/dev/null | grep -v 'picomeet/ops/backup.sh' ;
  echo "17 3 * * * /usr/bin/bash $APP_DIR/ops/backup.sh >/dev/null 2>&1" ) | crontab -
# ------------------------------ helper command -----------------------------
cat > /usr/local/bin/$APP <<EOF
#!/usr/bin/env bash
case "\$1" in
  logs)    journalctl -u $APP -f -n 100 ;;
  restart) systemctl restart $APP && echo "restarted" ;;
  status)  systemctl status $APP --no-pager ;;
  update)  cd $APP_DIR && sudo -u $APP_USER git pull && sudo -u $APP_USER npm install --omit=dev && systemctl restart $APP ;;
  backup)  sudo -u $APP_USER node $APP_DIR/server/cli.js backup "\${2:-$APP_DIR/data/backup-\$(date +%F).db}" ;;
  *)       shift 0; sudo -u $APP_USER node $APP_DIR/server/cli.js "\$@" ;;
esac
EOF
chmod +x /usr/local/bin/$APP
# --------------------------------- verify ----------------------------------
say "Verifying ..."
sleep 2
HEALTH=$(curl -fsS --max-time 5 http://127.0.0.1:8080/api/health || echo "")
[[ "$HEALTH" == *'"ok":true'* ]] || { journalctl -u $APP -n 40 --no-pager; die "App did not start."; }
RSS=$(echo "$HEALTH" | grep -o '"rssMB":[0-9]*' | cut -d: -f2)
cat <<EOF
$(echo -e "${C_G}")=========================================================
 PicoMeet is live.
   URL            : https://${DOMAIN}
   Admin console  : https://${DOMAIN}/admin.html
   Admin user     : ${ADMIN_USER}
   Memory in use  : ${RSS} MB
 Commands: picomeet logs | restart | status | update | backup
           picomeet create-user bob 'pass' host | list-users | stats
 Next steps:
   1. Sign in at https://${DOMAIN}/login.html
   2. Create host accounts in the admin console
   3. Hosts create rooms and share https://${DOMAIN}/j/<code>
 Media is peer-to-peer. Keep rooms <= 8 for best quality.
=========================================================$(echo -e "${C_0}")
EOF
