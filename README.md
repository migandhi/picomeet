# PicoMeet 🎥

**Self-hosted video conferencing that runs on a $6/month server.**

Peer-to-peer WebRTC classrooms and meetings. Your server handles only signalling
(a few KB per user); video flows browser-to-browser, end-to-end encrypted with
DTLS-SRTP. One installation script. Live in under 10 minutes.

> 70 MB RAM. 2 npm dependencies. Zero media bandwidth on the server (mesh mode).

---

## Why PicoMeet instead of the other free options?

| | **PicoMeet** | Jitsi Meet (self-host) | BigBlueButton | Zoom Free |
|---|---|---|---|---|
| Minimum server | **$6 / 1 GB droplet** | 8 GB recommended | 16 GB minimum | n/a (their cloud) |
| Server media bandwidth | **~0 (P2P mesh)** | All media relayed | All media relayed | n/a |
| Install | **1 script, ~5 min** | Multi-service | Complex | n/a |
| Time limit | None (you decide) | None | None | 40 min |
| Whiteboard + annotation | ✅ (P2P, zero server bytes) | Plugin | ✅ | ✅ |
| Multi-tenant accounts/limits | ✅ built-in admin | Manual | ✅ | n/a |
| Data ownership | **100% yours** | Yours | Yours | Zoom's |
| Firewall traversal | STUN + TURN (UDP **and** TCP) | ✅ | ✅ | ✅ |

The trade-off is honest: **mesh moves the cost from your server to participant
devices**, which is why PicoMeet is fantastic up to ~8 people per room and
switches to Lecture Mode beyond that. See [Limitations](#-limitations--read-this).

---

## Architecture

```
            Caddy (auto-HTTPS) ──► Node.js (signalling, auth, rooms, SQLite)
                                        │  WebSocket /ws — SDP/ICE/chat only
                 ┌──────────────────────┴──────────────────────┐
           Browser A ◄════ WebRTC P2P (DTLS-SRTP media) ════► Browser B
                 └───── optional coturn relay when P2P is blocked ─────┘
```

- **Adaptive Mesh Governor** — the server dictates a quality contract
  (resolution/fps/bitrate) that scales down as rooms grow, so laptops survive.
- **Lecture Mode** — beyond 9 people, only up to 4 "stage" publishers send media;
  the audience are *silent peers* (zero PeerConnections) — that's how a mesh
  system handles bigger classes.
- **TURN (optional)** — relays media for users behind strict NATs/firewalls,
  over UDP *and* TCP 3478, plus TLS on 5349.

---

## 🚀 Quick Start (go live in ~10 minutes)

### Step 1 — Get a server
Any Ubuntu 22.04/24.04 VPS with a public IP. Tested target: **DigitalOcean
$6 droplet (1 GB / 1 vCPU / 1 TB transfer)**. Vultr, Hetzner (€4), Linode,
Oracle free tier all work.

### Step 2 — Point DNS at it (any registrar)
Create one **A record**:

| Type | Host / Name | Value | TTL |
|------|-------------|-------|-----|
| A | `meet` (→ meet.yourdomain.com) | your server's public IPv4 | 300 |

Registrar-specific notes:
- **GoDaddy / Namecheap / Google / Cloudflare / anyone** — the A record above is all you need.
- **Cloudflare users:** set the record to **DNS only (grey cloud)**. The orange
  proxy breaks TURN and adds latency to WebSockets.
- **Free subdomains** work too: DuckDNS, ClouDNS, eu.org, afraid.org.
- Verify propagation before installing: `nslookup meet.yourdomain.com` must
  return your server IP. Usually < 5 minutes with TTL 300.
- Optional but recommended if using TURN: add a second A record `turn` →
  same IP (used for TLS-TURN).

### Step 3 — Install

```bash
ssh root@YOUR_SERVER_IP
git clone https://github.com/migandhi/picomeet.git
cd picomeet
sudo bash install.sh -d meet.yourdomain.com -e you@email.com \
     -u admin -p 'YourStrongPassword!' --with-turn
```

That's it. The installer sets up Node.js 20, Caddy (automatic HTTPS with
auto-renewal), systemd, UFW firewall, swap, coturn, daily backups, log
rotation, and unattended OS security updates — everything needed for
**long-term hands-off operation**.

### Step 4 — Use it
1. Sign in at `https://meet.yourdomain.com/login.html`
2. Admin console → create **host** accounts for your teachers/organisers
3. Hosts sign in → dashboard → **Create Room** → share `https://meet.yourdomain.com/j/abc-def-ghi`
4. Guests just click the link, type a name, and join. No account, no app, no download.

---

## 👤 Roles & SaaS model

| Role | Can do |
|---|---|
| **admin** | Everything: create users, set per-user limits (rooms, seats, minutes, expiry), end meetings, view usage |
| **host** | Create rooms, host meetings, moderate (mute/kick/stage/lock/lobby) |
| **user** | Join with an account (for rooms where guests are disabled) |
| **guest** | Join via link (+ optional PIN) |

**SaaS without a payment gateway (current design):** you sell access manually —
create a host account, set `max participants`, `max minutes` and an
**expiry date** in the admin console. When it expires, their meetings stop
automatically. All money logic funnels through `server/modules/billing.js`
(a stub), so adding Stripe/Razorpay later touches exactly one file plus one
webhook route.

---

## 🧭 Usage Guidelines (read before your first real class)

### Room sizes
| People | Experience | Recommendation |
|---:|---|---|
| 2–4 | Excellent (720p/540p) | Ideal |
| 5–6 | Very good (360p) | Recommended max for seminars |
| 7–8 | Good (270p) | Practical max on average laptops |
| 9–12 | Low-res, high client CPU | Use **Lecture Mode** |
| 13+ | — | Lecture Mode auto-engages (audience are view/chat-only until invited on stage) |

### Best practices
- **Hosts start the meeting** — guests cannot open an empty room (by design).
- Use a **PIN** or **lobby (knock)** for public links.
- **Screen sharing:** one presenter at a time; annotation (✏️) draws over
  the share via data channels — zero server load.
- **Whiteboard** works even with cameras off — great for low-bandwidth classes.
- Mobile users: joining works in Chrome/Safari; keep mobile rooms ≤ 4 for battery.
- Ask participants on weak Wi-Fi to **turn off video** — audio + whiteboard
  is extremely light (~40 kbps).
- Keyboard shortcuts: **M** mute · **V** camera · **D** draw.

### Server-wide caps (defaults, in `.env`)
```
8 concurrent meetings · 60 total live participants · 12 per room
```
Raise only after load-testing. The caps protect the droplet, not the media
(the server never carries media in mesh mode).

---

## ⚠️ Limitations — read this

Being honest is how we beat the competition:

1. **Mesh cost lands on participants.** In an N-person seminar each device
   encodes once but decodes N−1 streams and uploads N−1 copies. An 8-person
   room needs roughly **2–3 Mbps up** and a mid-range laptop. That is the
   physics of P2P, not a bug.
2. **A $6 droplet is small.** Defaults (8 meetings / 60 people) are safe.
   Signalling is tiny, but WebSocket + TURN load grows with users.
3. **TURN eats your bandwidth quota.** Direct P2P costs the server ~nothing;
   *relayed* users cost ~0.5 GB per participant-hour against the droplet's
   1 TB/month. coturn is capped (600 kbps/user, 60 sessions) to protect you.
   Typically only 10–20% of connections need TURN.
4. **No server-side recording.** Recording P2P media requires an SFU or client
   recording. Roadmap item.
5. **Live meetings end if the server restarts.** Room *definitions* persist
   in SQLite; live state is in memory — deliberate simplicity. `picomeet
   restart` = everyone rejoins via the same link (takes seconds).
6. **Single-server design.** One box, one domain, up to ~60 concurrent people.
   Need more? Deploy a second $6 droplet on another subdomain (shard by
   domain) — still cheaper than one big Jitsi box.
7. **iOS Safari quirks:** backgrounding the tab pauses video (OS policy);
   users should keep the tab foregrounded.
8. **Very strict corporate networks** that block all UDP *and* non-443 TCP may
   still fail even with TURN on 3478/5349. The fix is TURN-over-TLS on port
   443 — which requires a second IP or a dedicated TURN droplet (documented
   in `docs/LIMITS.md`).
9. **The bundled Go SFU is a prototype.** Do not expose it publicly without
   hardening (see `sfu/README.md`).

---

## 🔥 Firewall traversal (how PicoMeet gets through)

Connection attempts happen in this order, automatically:

1. **Direct P2P over UDP** (STUN-discovered) — ~80% of cases, zero server cost.
2. **TURN over UDP 3478** — strict NATs.
3. **TURN over TCP 3478** — UDP-blocking firewalls (offices, hotels).
4. **TURN over TLS 5349** — deep-packet-inspection environments.

All of this is transparent to users. Enable it with `--with-turn` at install
time. Signalling itself always travels over WSS on port 443, which every
network allows.

---

## 🛠 Operations

```bash
picomeet logs        # tail live logs
picomeet status      # service status
picomeet restart     # restart app (ends live meetings)
picomeet update      # git pull + npm install + restart
picomeet backup      # snapshot SQLite now (daily cron already runs at 03:17)
picomeet stats       # 30-day usage
picomeet list-users
picomeet create-user teacher1 'password123' host
picomeet passwd teacher1 'newpassword'
```

Health endpoint for uptime monitors (UptimeRobot etc. — free):
`https://meet.yourdomain.com/api/health`

**Disaster recovery:** copy `data/backup-*.db.gz` off-box weekly. Restoring =
fresh install + drop the DB file into `/opt/picomeet/data/picomeet.db`.

---

## 🔒 Security

- Media is **end-to-end encrypted** (DTLS-SRTP) between browsers; the server
  cannot see or hear anything even in principle (mesh mode).
- scrypt password hashing, HttpOnly/SameSite session cookies, login rate
  limiting, per-account expiry, admin audit log.
- systemd sandboxing (`ProtectSystem=strict`, memory caps), UFW default-deny,
  security headers via Caddy, automatic TLS renewal, unattended OS patches.
- Whiteboard/annotation strokes travel over encrypted data channels only.

Recommended before selling access: independent security review + pen test.

---

## 💾 Local development

```bash
git clone https://github.com/migandhi/picomeet.git
cd picomeet && npm install
cp .env.example .env          # keep PM_PUBLIC_URL=http://localhost:8080
node server/cli.js create-admin admin 'devpassword'
npm run dev                   # http://localhost:8080
```
Browsers allow camera/mic on `localhost` without HTTPS.
Windows workflow: see `DEVELOPMENT-WINDOWS.md`.

---

## 📦 Publishing your own fork to GitHub

```bash
# 1. Create an empty repo on github.com (no README/license — you have them)
# 2. Then:
git clone https://github.com/migandhi/picomeet.git
cd picomeet
git remote set-url origin https://github.com/YOURNAME/picomeet.git
git add -A
git commit -m "PicoMeet v1.1 production release"
git branch -M main
git push -u origin main
```
Update `REPO_URL` at the top of `install.sh` (or pass
`PM_REPO=https://github.com/YOURNAME/picomeet.git`) so the one-line installer
pulls **your** fork:

```bash
curl -fsSL https://raw.githubusercontent.com/YOURNAME/picomeet/main/install.sh \
  | sudo PM_REPO=https://github.com/YOURNAME/picomeet.git bash -s -- \
  -d meet.yourdomain.com -e you@mail.com -u admin -p 'StrongPass!' --with-turn
```

Never commit `.env`, `data/*.db`, backups, or `node_modules` (already
gitignored).

---

## 🗺 Roadmap

Client-side recording · breakout rooms · polls & attendance export ·
hardened SFU for 50+ lectures · Stripe/Razorpay via `modules/billing.js` ·
E2E tests.

## License

AGPL-3.0-or-later. If you run a modified version as a service, you must
publish your modifications — which keeps the ecosystem honest.
