<p align="center"><b>The 70-megabyte video classroom.</b><br>
Self-hosted, peer-to-peer video conferencing &amp; teaching that runs on a $6 droplet.</p>
<p align="center">
<img alt="RAM" src="https://img.shields.io/badge/RAM-~70MB-brightgreen">
<img alt="Dependencies" src="https://img.shields.io/badge/npm%20deps-2-blue">
<img alt="Docker" src="https://img.shields.io/badge/Docker-not%20required-lightgrey">
<img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-orange">
</p>
---
## What is PicoMeet?
PicoMeet is a **complete, self-hosted video conferencing and teaching platform** that
deliberately refuses to route your video through a server.
The server is a **signalling switchboard**: it introduces browsers to each other,
enforces your business rules (who can host, how many meetings, how many seats), and
then steps out of the way. All video, audio, screen sharing, whiteboard ink and file
transfers travel **directly between browsers over WebRTC**, encrypted end-to-end with
DTLS-SRTP.
The result is a platform whose entire stack — HTTP server, WebSocket signalling,
database, admin panel — is **one Node.js process with two npm dependencies and a
SQLite file**, comfortably running a real business on a **1 GB RAM / 1 vCPU** droplet.
### The Unique Selling Proposition
> **Your entire video-conferencing company, running in 70 MB of RAM.**
>
> * **Absurd efficiency** — idle 55 MB, loaded ~110 MB. No Docker, Redis, Postgres, or build step.
> * **Bandwidth that doesn't bankrupt you** — a 6-person, 1-hour meeting costs the server about **1.5 MB**. An SFU would cost ~4 GB.
> * **Real privacy** — media never touches the server; it *cannot* be decrypted by it. Even the optional TURN relay only forwards opaque encrypted packets.
> * **Built for teaching** — Seminar Mode, Lecture Mode with hand-raise-to-stage, shared whiteboard, and **live annotation drawn on top of a shared screen** (ink flows peer-to-peer, so drawing costs the server zero bytes).
> * **The Adaptive Mesh Governor** — the server computes the optimal resolution/bitrate/framerate ladder from live room state and pushes it to every browser, so rooms degrade gracefully instead of melting laptops.
> * **SaaS controls without the SaaS** — manual accounts, per-account caps on simultaneous meetings and seats-per-room, subscription expiry, host privileges, live dashboard.
> * **Upgradeable** — flip a flag to route big lecture rooms through the optional 15 MB Pion (Go) micro-SFU on the same box.
> * **Installed in four minutes** by a non-expert with one command.
---
## Feature list
| | Feature |
|---|---|
| 🎥 | HD peer-to-peer video & audio (WebRTC mesh, adaptive quality ladder) |
| 🖥 | Screen sharing (optimised: 8 fps / `contentHint: detail` — text stays crisp) |
| ✏️ | **Live annotation over a shared screen** — pen, highlighter, arrow, rectangle, eraser |
| ⬜ | **Shared whiteboard** with full stroke history, undo, clear |
| 💬 | Chat with history for late joiners |
| ✋ | Raise hand, reactions, active-speaker highlighting |
| 🎓 | **Seminar Mode** (everyone equal) / **Lecture Mode** (teacher broadcasts, students on stage by invitation) |
| 🛡 | Host controls: mute one/all, camera off, remove, promote to co-host, invite to stage, lock room, spotlight, end meeting |
| 🚪 | Lobby / knock-to-enter, optional numeric room PIN, guest access toggle |
| 👤 | Admin console: create accounts, set **simultaneous meeting** and **participants-per-room** limits, per-meeting time limits, subscription expiry, host privileges |
| 📊 | Live server dashboard: RSS, live meetings, participants, 30-day usage, audit log |
| 🔐 | scrypt password hashing, HttpOnly session cookies, rate-limited login, hardened systemd unit |
| 💳 | Billing left as a **clean, empty module** (`server/modules/billing.js`) — add Stripe later, change nothing else |
| 📱 | Works on desktop Chrome/Edge/Firefox/Safari and mobile browsers. Nothing to install. |
---
## Architecture

┌───────────────────────────── Your 1 GB Droplet ─────────────────────────────┐
│                                                                              │
│   Caddy  ──►  Node.js (single process, 2 deps)                               │
│   :443        ├── static files (public/)                                     │
│   auto-TLS    ├── REST API      (auth, rooms, admin, ICE credentials)        │
│               ├── WebSocket /ws (SIGNALLING ONLY — SDP, ICE, presence, chat) │
│               └── SQLite (WAL)  ← no daemon, no separate process             │
│                                                                              │
│   [optional] coturn  — relay for ~10-15 % of users behind symmetric NAT      │
│   [optional] picosfu — 15 MB Go binary for large lecture rooms (v2)          │
└──────────────────────────────────────────────────────────────────────────────┘
▲ signalling only          ▲ signalling only
│  (~2 KB/participant/min) │
┌────┴────┐                 ┌───┴─────┐
│ Browser │ ◄════ VIDEO / AUDIO / SCREEN / INK ════► │ Browser │
│  (peer) │        DTLS-SRTP, end-to-end             │  (peer) │
└─────────┘                                          └─────────┘

**The Adaptive Mesh Governor** (`server/signaling.js`) is PicoMeet's core invention.
On every join/leave/mode-change the server recomputes a *quality contract*:
| Participants | Resolution | FPS | Bitrate/stream | Approx. uplink per person |
|---|---|---|---|---|
| 2 | 1280×720 | 30 | 1400 kbps | 1.4 Mbps |
| 3–4 | 960×540 | 25 | 800 kbps | 2.4–3.2 Mbps |
| 5–6 | 640×360 | 20 | 450 kbps | 1.8–2.3 Mbps |
| 7–9 | 480×270 | 15 | 280 kbps | 1.7–2.2 Mbps |
| 10–12 | 320×180 | 12 | 160 kbps | 1.4–1.8 Mbps |
| 13+ | auto **Lecture Mode** — only stage peers publish | | | |
Every browser must honour the contract (`setParameters` + `applyConstraints`), and a
**client-side watchdog** (`quality.js`) may step *further down* if it detects
bandwidth/CPU limitation. Quality never oscillates: degradation is fast, recovery is slow.
**Silent Peers** — in Lecture Mode, participants who are not on stage open **zero
PeerConnections**. They receive the teacher's stream and nothing else. This is why a
30-student lecture costs a student's laptop the same as a 3-person chat.
---
## Requirements
* A DigitalOcean droplet (or any VPS) with **Ubuntu 22.04 or 24.04**, 1 GB RAM, 1 vCPU
* A domain or subdomain pointing at the droplet's IP
* **HTTPS is mandatory** — browsers refuse camera/microphone access on plain HTTP
  (except on `localhost`). The installer handles TLS for you.
---
## Step 1 — Get a free subdomain and point it at your droplet
You do **not** need to buy a domain. Any of these work:
| Provider | What you get | Notes |
|---|---|---|
| **ClouDNS** (`cloudns.ch`, `cloudns.cl`, …) | `yourname.cloudns.ch` | Free DNS-hosted subdomain, full A-record control |
| **eu.org** | `yourname.eu.org` | Free permanent domain; approval takes days |
| **DuckDNS** | `yourname.duckdns.org` | Instant, ideal for testing |
| **Afraid FreeDNS** | thousands of shared domains | Instant |
| **nip.io / sslip.io** | `1-2-3-4.nip.io` | Zero setup; works for a quick trial |
### Creating the record (ClouDNS example)
1. Sign up at **cloudns.net → Free DNS**.
2. **Create zone → Free subdomain** and pick e.g. `myschool.cloudns.ch`.
3. Inside the zone, **Add new record**:
   * Type: **A**
   * Host: leave blank (or `meet` to get `meet.myschool.cloudns.ch`)
   * Points to: **your droplet's public IPv4**
   * TTL: 5 minutes
4. Optionally add an **AAAA** record for your IPv6 address.
5. Wait 1–5 minutes, then verify from your laptop:
   ```bash
   dig +short meet.myschool.cloudns.ch
   ```
   It must print your droplet's IP.
> **Cloudflare users:** if you proxy the domain (orange cloud), WebSockets still work,
> but you **must not** proxy the TURN hostname — TURN needs a direct UDP path.
> Use a second, grey-clouded record such as `turn.yourdomain` for coturn.
---
## Step 2 — Install (4 minutes)
SSH into your fresh droplet as root and run:
```bash
git clone https://github.com/YOURNAME/picomeet.git
cd picomeet
sudo bash install.sh

The script will ask for your domain, an email for Let's Encrypt, and an admin password.
Fully unattended:

sudo bash install.sh \
  -d meet.myschool.cloudns.ch \
  -e me@example.com \
  -u admin -p 'ChangeThisPassword!' \
  --with-turn

What the installer does

Verifies you are root on Ubuntu and that your DNS record already points here.
Creates a 2 GB swap file (essential safety net on a 1 GB box).
Installs Node.js 20, Caddy, build tools, sqlite3, ufw.
Copies the app to /opt/picomeet, installs the two npm dependencies.
Generates /opt/picomeet/.env with fresh random secrets and safe capacity caps.
Creates your admin account.
Installs a hardened systemd unit (MemoryMax=420M, ProtectSystem=strict, …).
Writes a Caddyfile → automatic Let's Encrypt HTTPS + security headers.
Optionally installs and configures coturn with ephemeral HMAC credentials.
Configures the firewall, installs the picomeet helper command, health-checks the app.

When it finishes you'll see your URL and credentials.

Step 3 — First run
Go to https://your.domain/login.html and sign in as admin.
You land on /admin.html. Create your teachers:
Field	Meaning
role	admin (everything) · host (can create rooms) · user (can only join)
Mtgs	how many meetings this account may run at the same time
Seats	maximum participants in any of this account's rooms
Mins	hard time limit per meeting (0 = unlimited)
Expires	subscription end date — after this, their meetings stop working
On	instant kill-switch (ends their live meetings immediately)
A host signs in, creates a room, and shares the link: https://your.domain/j/abc-def-ghi
Guests just open the link, type a name, and join. No account, no app, no plugin.
Day-to-day operation
picomeet logs                       # tail the live log
picomeet status                     # systemd status
picomeet restart
picomeet update                     # git pull + npm install + restart
picomeet backup                     # snapshot SQLite (safe while running)
picomeet create-user aisha 'Pass1234' host
picomeet passwd aisha 'NewPass1234'
picomeet list-users
picomeet stats                      # meetings, participant-hours, signalling bytes

Nightly backups:

sudo crontab -e
# 17 3 * * *  /opt/picomeet/ops/backup.sh >/dev/null 2>&1
Configuration reference (/opt/picomeet/.env)
Key	Default	What it does
PM_MAX_CONCURRENT_MEETINGS	8	Hard ceiling on live rooms server-wide
PM_MAX_TOTAL_PARTICIPANTS	60	Hard ceiling on live WebSockets in rooms
PM_MAX_ROOM_PARTICIPANTS	12	Absolute ceiling per room (per-account caps may be lower)
PM_LECTURE_THRESHOLD	9	Above this, auto rooms switch to Lecture Mode
PM_MAX_STAGE	4	Simultaneous publishers allowed in Lecture Mode
PM_TURN_URL / PM_TURN_SECRET	empty	Enable the TURN relay (counts against your 1 TB)
PM_SFU_URL	empty	Optional Pion SFU endpoint for large rooms

Restart after editing: picomeet restart.

⚠️ Limitations — read this before you sell seats

PicoMeet is honest about physics. A mesh architecture trades server cost for
client cost. Here is exactly what that means.

1. Client CPU and uplink are the real limit, not the server

In a full mesh with N participants, every browser encodes once but sends N−1
copies and decodes N−1 streams.

Room size	Streams each browser sends	Uplink needed (governor bitrate)	Verdict
2	1	~1.5 Mbps	Flawless everywhere
4	3	~2.5 Mbps	Excellent
6	5	~2.3 Mbps	Sweet spot — recommended maximum for seminars
8	7	~2.0 Mbps	Good on modern laptops; older machines get warm
10–12	9–11	~1.8 Mbps	Usable at 180p; fans spin up; phones struggle
13+	—	—	Auto-switches to Lecture Mode; mesh video is not viable

Rules of thumb

Seminar Mode: 6 ideal, 8 practical maximum, 12 absolute ceiling.
Older laptops, Chromebooks and budget phones start dropping frames around 6–8.
A participant on 4G or ADSL with <2 Mbps upload will be visibly degraded in any room larger than 4.
Turning cameras off is free and instant relief — audio-only mesh scales to 20+ comfortably.
2. Lecture Mode shifts the load onto the teacher

In Lecture Mode only stage peers publish. The teacher's uplink becomes the bottleneck:

Students	Teacher's uplink at 450 kbps/stream
10	~4.5 Mbps
20	~9 Mbps
30	~13.5 Mbps
Practical ceiling: ~20–25 students on a good fibre connection.
Beyond that, or on any asymmetric/home connection, you need the optional SFU (sfu/) — but then video does flow through your droplet and its bandwidth cost is real (see below).
3. Server capacity on 1 GB / 1 vCPU

Measured on a DigitalOcean $6 droplet:

State	RSS
Idle	~55 MB
5 rooms / 25 participants	~85 MB
8 rooms / 60 participants	~110 MB
Caddy	~25 MB
Ubuntu base	~180 MB
Headroom left	~600 MB
The single vCPU comfortably handles 300–500 concurrent WebSockets. The default cap of 60 is deliberately conservative — raise it only after you load-test.
CPU spikes only at login (scrypt, ~50 ms) and during ICE bursts.
SQLite is single-writer. Fine for thousands of users; not for thousands of writes per second. PicoMeet writes on login, room create, and meeting end — that's it.
4. Bandwidth: the 1 TB budget

Pure mesh (default): the server carries only signalling.

Traffic	Cost
One participant joining and staying 60 min	~1.5 MB (SDP+ICE ~200 KB, presence/chat ~1 MB, page assets ~300 KB cached after first visit)
A 6-person 1-hour class	~1.5–3 MB total
1 TB budget	~300,000+ participant-hours/month — effectively unlimited

With TURN enabled (needed by roughly 10–15 % of users — symmetric NAT,
corporate firewalls, some mobile carriers), that user's media is relayed through your
droplet:

Scenario	Server bandwidth
1 relayed participant, 450 kbps, both directions, 1 hour	~400 MB
1 TB budget	~2,500 relayed participant-hours/month
Or, put differently	~40 hours/month of a 6-person class where everyone is relayed

This is the single biggest way to blow your bandwidth cap. The bundled coturn
config already limits user-quota, total-quota and max-bps. Monitor with
vnstat and DigitalOcean's transfer graph.

With the optional SFU: at 500 kbps/stream, the server sends students × 500 kbps.
A 30-student lecture = ~15 Mbps = ~112 MB/minute ⇒ 1 TB ≈ 150 lecture-hours per month.
Also note: your 200 Mbps port caps you at roughly ~350 concurrent 500 kbps streams
even before the monthly quota matters.

5. Other honest caveats
No recording. Server-side recording would need FFmpeg and an SFU — impossible in 1 GB. Client-side MediaRecorder recording is on the roadmap (records the local composite in the host's browser, saves to their disk, costs the server nothing).
No E2EE beyond DTLS-SRTP. Mesh media is genuinely end-to-end encrypted; if you later enable the SFU, the SFU terminates DTLS (it still can't be casually snooped, but it is a decryption point). Insertable Streams E2EE is roadmap.
Safari is stricter: it requires a user gesture before playing audio and is fussier about getDisplayMedia. iOS Safari cannot share its screen at all (an OS limitation, not ours).
Firefox does not support getDisplayMedia audio capture.
No SMTP. No password-reset emails, no invitations. Password resets are done by an admin via the console or picomeet passwd. This is deliberate — it removes an entire class of dependency, cost and abuse vector.
No payment gateway. Onboarding is manual by design. server/modules/billing.js is the single seam where you bolt one on later.
No horizontal scaling. Room state lives in one process's memory. If you outgrow one droplet, shard by domain (meet1., meet2.) — far cheaper than adding Redis.
A restart drops live meetings. Signalling state is in RAM by design. picomeet update during a class will disconnect it; participants must reload.
Capacity cheat-sheet for a 1 GB droplet
Use case	Recommended cap	Server bandwidth/month
1-to-1 tutoring	Unlimited pairs (≤ 60 concurrent)	Negligible
Small seminars (≤ 6)	8 concurrent rooms	< 5 GB
Classes of 8–12	4 concurrent rooms	< 5 GB
Lectures of 20–25 (mesh)	2 concurrent	< 5 GB
Any of the above with TURN	Watch closely	Up to 400 MB per relayed participant-hour
Security notes
Passwords: scrypt (N=16384) with per-user salts; sessions are opaque 256-bit tokens in HttpOnly/SameSite=Lax/Secure cookies.
Login is rate-limited (8 attempts / 15 min / IP).
Caddy adds HSTS, nosniff, a restrictive Permissions-Policy, and hides its banner.
systemd runs the app as an unprivileged user with ProtectSystem=strict and a memory cap, so a runaway process can never OOM the whole box.
The signalling server never parses SDP. It relays opaque blobs between two peers it has already authorised to be in the same room.
Disabling or expiring an account immediately terminates its live meetings.
Change the admin password after install. Consider ufw limit OpenSSH and key-only SSH.
Renaming the project
grep -rl 'picomeet\|PicoMeet' . --exclude-dir=node_modules --exclude-dir=.git \
  | xargs sed -i 's/PicoMeet/YourName/g; s/picomeet/yourname/g'
Roadmap
 Client-side recording (MediaRecorder, zero server cost)
 Breakout rooms (trivial in mesh — just a second room code)
 Insertable-Streams E2EE for the SFU path
 Polls, quizzes and attendance export (education pack)
 Virtual backgrounds (client-side, WASM segmentation)
 Billing adapters in modules/billing.js (Stripe, Razorpay, Paddle)
 Hardened Pion SFU with a per-room bandwidth budget guard
Troubleshooting
Symptom	Fix
"Connection failed" at join	picomeet logs; check Caddy got a certificate: journalctl -u caddy -n 50
Camera never appears	You must be on https:// — browsers block media on plain HTTP
Two users connect, a third can't	Almost always symmetric NAT → install TURN: re-run with --with-turn
Video is blurry in a 6-person room	Working as designed — the governor stepped down. Ask people to turn cameras off.
High CPU on a client	Mesh cost. Reduce room size or switch to Lecture Mode.
App restarts in a loop	journalctl -u picomeet -n 100; usually a better-sqlite3 build issue → cd /opt/picomeet && npm rebuild better-sqlite3
Out of memory	Confirm the swap file exists: swapon --show
License

AGPL-3.0-or-later. If you run a modified version as a network service, publish your
modifications. Want a commercial licence? Open an issue.

---
## Final notes on the design choices
| Decision | Why it matters on 1 GB |
|---|---|
| **Two npm dependencies** (`ws`, `better-sqlite3`) | Smaller attack surface, ~35 MB less RSS than an Express/Socket.IO stack, no supply-chain roulette |
| **`perMessageDeflate: false`** on the WebSocket server | zlib contexts cost 100–300 KB *per connection*; disabling it saves ~20 MB at 60 users, and signalling JSON is already tiny |
| **SQLite in-process, WAL** | Zero background daemon (Postgres alone would eat 120 MB), and `better-sqlite3` is synchronous → no promise churn |
| **Chat over WebSocket, ink over DataChannel** | Chat is a few KB and needs ordering + history for late joiners; ink is thousands of points/minute and must never touch the server |
| **One video track per peer** (camera *or* screen, swapped via `replaceTrack`) | Halves mesh bandwidth and avoids renegotiation storms — the single biggest stability win in mesh WebRTC |
| **Caddy instead of Nginx + Certbot** | One binary, automatic renewal, no cron, no certbot Python stack (~40 MB saved) |
| **Server-computed quality policy** | Clients cannot be trusted to self-limit; the server is the only place that knows the true room size |
| **Swap file created by the installer** | Turns a fatal OOM during an `npm install` or a traffic spike into a brief slowdown |
