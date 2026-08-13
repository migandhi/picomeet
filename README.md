# PicoMeet

A lightweight, self-hosted video conferencing and classroom application built around WebRTC peer-to-peer media.

> **Current repository status:** this repository contains the PicoMeet source implementation and deployment scaffolding. It is suitable for development and further testing, but it should not be described as production-ready until the remaining UI and deployment paths are tested.

## Overview

PicoMeet is designed to keep the media path out of the application server whenever possible.

The Node.js server provides:

- HTTP/static file serving
- REST API
- WebSocket signalling
- Authentication and sessions
- Room management
- Host/admin controls
- SQLite persistence
- ICE/STUN/TURN configuration
- Usage statistics

The browser handles the WebRTC media path.

```text
                         PicoMeet server
                    ┌─────────────────────┐
                    │       Node.js       │
                    │                     │
                    │ REST API            │
                    │ WebSocket /ws       │
                    │ Authentication      │
                    │ Room state          │
                    │ SQLite              │
                    └──────────┬──────────┘
                               │
                         signalling only
                               │
              ┌────────────────┴────────────────┐
              │                                 │
        ┌─────▼─────┐                     ┌─────▼─────┐
        │  Browser  │◄──── WebRTC P2P ───►│  Browser  │
        │ Participant│   audio/video/data  │ Participant│
        └───────────┘                     └───────────┘
```

The optional TURN server can relay WebRTC traffic when a direct peer-to-peer connection cannot be established.

The repository also contains an optional Go/Pion SFU prototype for a future larger-room architecture.

---

## Features implemented in the source

### WebRTC

- Peer-to-peer audio
- Peer-to-peer video
- WebRTC signalling over WebSocket
- ICE server configuration
- STUN support
- Optional TURN support
- Adaptive video quality
- Client-side quality monitoring
- Screen sharing

### Classroom tools

- Seminar mode
- Lecture mode
- Stage management
- Raise hand
- Reactions
- Chat
- Shared whiteboard
- Screen annotation
- Pen
- Marker
- Arrow
- Rectangle
- Eraser
- Undo
- Clear

### Host controls

The room implementation contains controls for:

- Mute participant
- Mute all
- Camera control
- Remove participant
- Promote to co-host
- Invite to stage
- Lock room
- Spotlight
- End meeting

### Authentication

- Username/password login
- scrypt password hashing
- Session cookies
- Session expiry
- Login rate limiting
- Account activation/deactivation
- Subscription expiry checks
- Admin-only API

### Administration

The current repository includes an administrator interface for:

- Viewing server statistics
- Viewing live meetings
- Ending live meetings
- Creating users
- Changing user roles
- Changing room limits
- Changing participant limits
- Changing meeting time limits
- Setting expiry dates
- Activating/deactivating users
- Deleting users
- Resetting passwords

Supported roles:

| Role | Description |
|---|---|
| `admin` | Full administration |
| `host` | Can create and host rooms |
| `user` | Can join rooms but cannot create rooms |

---

## Adaptive Mesh Governor

The server contains an adaptive quality policy in:

```text
server/signaling.js
```

The current quality ladder is:

| Participants | Resolution | FPS | Video bitrate |
|---:|---:|---:|---:|
| 1–2 | 1280×720 | 30 | 1400 kbps |
| 3–4 | 960×540 | 25 | 800 kbps |
| 5–6 | 640×360 | 20 | 450 kbps |
| 7–9 | 480×270 | 15 | 280 kbps |
| 10–12 | 320×180 | 12 | 160 kbps |
| 13+ | 320×180 | 10 | 120 kbps |

Screen sharing currently uses:

```text
1600×900
8 FPS
700 kbps
```

These values are application defaults, not guaranteed performance figures.

---

## Lecture Mode

When a room is in lecture mode, only participants on the stage are intended to publish media.

The server's default configuration is:

```env
PM_LECTURE_THRESHOLD=9
PM_MAX_STAGE=4
```

This is intended to reduce the number of peer connections required by audience members.

---

# Repository structure

```text
picomeet/
│
├── README.md
├── LICENSE
├── package.json
├── .env.example
├── .gitignore
├── DEVELOPMENT-WINDOWS.md
├── install.sh
│
├── server/
│   ├── index.js
│   ├── config.js
│   ├── db.js
│   ├── auth.js
│   ├── http.js
│   ├── ice.js
│   ├── signaling.js
│   ├── cli.js
│   │
│   ├── routes/
│   │   ├── api.js
│   │   └── admin.js
│   │
│   ├── modules/
│   │   └── billing.js
│   │
│   └── migrations/
│       └── 001_init.sql
│
├── public/
│   ├── index.html
│   ├── login.html
│   ├── room.html
│   ├── admin.html
│   │
│   ├── css/
│   │   └── app.css
│   │
│   └── js/
│       ├── mesh.js
│       ├── quality.js
│       ├── board.js
│       ├── room.js
│       └── admin.js
│
├── sfu/
│   ├── main.go
│   ├── go.mod
│   └── README.md
│
├── ops/
│   ├── picomeet.service
│   ├── Caddyfile
│   ├── turnserver.conf.tmpl
│   ├── update.sh
│   └── backup.sh
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── LIMITS.md
│   └── API.md
│
├── data/
│   └── .gitkeep
│
└── .github/
    └── workflows/
        └── node.yml
```

---

# Technology

## Backend

- Node.js
- Native Node.js HTTP server
- WebSocket (`ws`)
- SQLite (`better-sqlite3`)
- CommonJS modules

## Frontend

- HTML
- CSS
- JavaScript ES modules
- WebRTC
- WebRTC DataChannels
- Canvas

There is currently no frontend framework or bundler.

## Optional media infrastructure

- coturn for TURN
- Go + Pion WebRTC for the optional SFU

---

# Requirements

## Development

- Git
- Node.js 18 or newer
- A modern browser with WebRTC support

The deployment installer targets Node.js 20.

## Production starting point

The included deployment design targets:

- Ubuntu 22.04 or 24.04
- 1 GB RAM
- 1 vCPU
- Public IP address
- Domain/subdomain
- HTTPS

These are starting requirements, not capacity guarantees.

---

# Installation

🛠️ Complete Installation Guide
1. Prerequisites
Before running the installer, ensure you have the following:

A clean installation of Ubuntu 22.04 or 24.04 LTS.

A registered Domain Name (e.g., meet.yourdomain.com).

DNS A Records pointing your domain (and optionally a turn. subdomain) to your server's public IPv4 address.

Root or sudo privileges on your server.

2. Running the Installer
Log into your server via SSH and execute the one-line installer:

```bash

curl -fsSL https://raw.githubusercontent.com/migandhi/picomeet/main/install.sh | sudo bash

```

3. What to Expect During Setup (Interactive Prompts)
The setup script will guide you through the configuration process. Have the following information ready:

Domain Name: You will be prompted to enter the domain you mapped in your DNS settings (e.g., meet.example.com). This is required to configure the Caddy web server and automatically provision a free SSL certificate.

Admin Email (Let's Encrypt): The script will ask for an email address. This is strictly used by the Certificate Authority to notify you of SSL expirations or critical security updates.

Master Admin Credentials: You will be asked to create the primary account used to access the dashboard:

Admin Username

Admin Password (Ensure this is at least 8 characters)

WebRTC Configuration (STUN / TURN):

STUN: The script defaults to lightweight public STUN servers (like Google or Cloudflare) for basic IP discovery.

TURN: To ensure video connections successfully punch through strict corporate firewalls, you will be prompted to configure a TURN relay. You can either allow the script to install and configure a local instance of coturn automatically, or you can input the credentials (URL, Username, Password) of an external third-party TURN provider.

4. Post-Installation & First Login
Once the script finishes executing, all required services will automatically start in the background.

Open your web browser and navigate to your domain (e.g., [https://meet.yourdomain.com/login.html](https://meet.yourdomain.com/login.html)).

Log in using the Admin Credentials you defined during step 3.

Access the Admin Panel to create additional Host/User accounts, adjust concurrent meeting limits, and start generating secure room links!

⚙️ Managing the Server
PicoMeet is managed entirely via standard systemd commands. Use these to monitor or restart your deployment:

```bash

# Check if the PicoMeet service is running
sudo systemctl status picomeet

# View live connection traffic and error logs
sudo journalctl -u picomeet -f

# Restart the application (e.g., after updating CSS or HTML files)
sudo systemctl restart picomeet

```

## Manual Clone the repository

```bash
git clone https://github.com/YOURNAME/picomeet.git
cd picomeet
```

## Install Node dependencies

```bash
npm install
```

The application currently declares two runtime dependencies:

```text
better-sqlite3
ws
```

## Configure environment

Copy the example file:

```bash
cp .env.example .env
```

Edit `.env` before running the application.

Example:

```env
PM_PORT=8080
PM_HOST=127.0.0.1
PM_PUBLIC_URL=http://localhost:8080
PM_DB=./data/picomeet.db
PM_SECRET=change-this-secret

PM_SESSION_DAYS=14

PM_MAX_CONCURRENT_MEETINGS=8
PM_MAX_TOTAL_PARTICIPANTS=60
PM_MAX_ROOM_PARTICIPANTS=12

PM_LECTURE_THRESHOLD=9
PM_MAX_STAGE=4

PM_STUN=stun:stun.l.google.com:19302

PM_TURN_URL=
PM_TURN_SECRET=
PM_TURN_TTL=7200

PM_SFU_URL=
```

For production, use a strong random value for `PM_SECRET`.

---

# Run locally

Start the server:

```bash
npm start
```

Or use Node's development watch mode:

```bash
npm run dev
```

The default local address is:

```text
http://localhost:8080
```

Open:

```text
http://localhost:8080/
```

The landing page accepts a meeting code and redirects to the room.

---

# Windows development

If you are developing on Windows:

```powershell
git clone https://github.com/YOURNAME/picomeet.git
cd picomeet

npm install

Copy-Item .env.example .env

npm run dev
```

Then open:

```text
http://localhost:8080/
```

See:

```text
DEVELOPMENT-WINDOWS.md
```

for the Windows-specific workflow.

---

# Create the first administrator

The command-line interface supports administrator creation:

```bash
node server/cli.js create-admin admin 'YourPassword'
```

Password requirements currently require at least 8 characters.

After creating the administrator, sign in at:

```text
/login.html
```

The administrator interface is:

```text
/admin.html
```

---

# CLI

Available commands:

```bash
node server/cli.js create-admin [user] [pass]
```

```bash
node server/cli.js create-user [user] [pass] [host|user]
```

```bash
node server/cli.js passwd [user] [pass]
```

```bash
node server/cli.js list-users
```

```bash
node server/cli.js stats
```

```bash
node server/cli.js backup [file.db]
```

---

# HTTP endpoints

The application currently exposes the following API endpoints.

## Authentication

```text
POST /api/login
POST /api/logout
GET  /api/me
```

## Rooms

```text
POST   /api/rooms
DELETE /api/rooms/:code
GET    /api/room/:code
```

## WebRTC

```text
GET /api/ice
```

## Health

```text
GET /api/health
```

## Administration

```text
GET    /api/admin/users
POST   /api/admin/users
PATCH  /api/admin/users/:id
DELETE /api/admin/users/:id

GET    /api/admin/live
POST   /api/admin/rooms/:code/end
GET    /api/admin/audit
```

## WebSocket

WebRTC signalling is provided at:

```text
/ws
```

The WebSocket server is implemented in:

```text
server/signaling.js
```

---

# Meeting links

The server supports short meeting URLs:

```text
/j/abc-def-ghi
```

These redirect to:

```text
/room.html?r=abc-def-ghi
```

The public landing page also accepts a meeting code:

```text
/
```

---

# Database

PicoMeet uses SQLite.

The default database path is:

```text
data/picomeet.db
```

The database is intentionally not committed to Git.

The `.gitignore` excludes:

```text
*.db
*.db-wal
*.db-shm
*.db.gz
```

Database initialization is defined in:

```text
server/migrations/001_init.sql
```

---

# Backup

The CLI supports SQLite backups:

```bash
node server/cli.js backup ./data/backup.db
```

The repository also contains:

```text
ops/backup.sh
```

The deployment design can schedule this script with cron.

---

# Production deployment

The repository contains:

```text
install.sh
```

The installer is designed for Ubuntu.

Example:

```bash
sudo bash install.sh
```

It can configure:

- Node.js
- Caddy
- SQLite
- systemd
- UFW
- swap
- application files
- HTTPS
- optional coturn
- administrator account

An unattended installation can be started with:

```bash
sudo bash install.sh \
  -d meet.example.com \
  -e admin@example.com \
  -u admin \
  -p 'CHANGE_THIS_PASSWORD' \
  --with-turn
```

Do not use the example password in a real deployment.

---

# Caddy

The repository contains a deployment template:

```text
ops/Caddyfile
```

Caddy reverse-proxies requests to:

```text
127.0.0.1:8080
```

It also provides HTTPS when configured with a real domain.

---

# systemd

The repository contains:

```text
ops/picomeet.service
```

The production installer creates the corresponding systemd service.

The application is intended to run as an unprivileged service account.

---

# TURN

TURN support is optional.

Configure:

```env
PM_TURN_URL=turn:your-domain.example:3478
PM_TURN_SECRET=your-secret
PM_TURN_TTL=7200
```

The installer can install coturn:

```bash
sudo bash install.sh --with-turn
```

TURN should be enabled only when required because relayed media consumes server bandwidth.

---

# Optional SFU

The repository contains an optional Go/Pion SFU prototype:

```text
sfu/
```

Build it with:

```bash
cd sfu
go build -ldflags="-s -w" -o picosfu .
```

The SFU listens on:

```text
127.0.0.1:7000
```

The supplied SFU is a **reference implementation**, not a production-hardened public SFU.

Before exposing it to the Internet, add appropriate:

- authentication
- authorization
- origin validation
- resource limits
- bandwidth limits
- cleanup
- monitoring
- production RTCP/PLI handling

---

# Capacity and limitations

PicoMeet's default architecture is a mesh.

In mesh mode, every participant maintains connections to other participants.

Therefore, increasing room size increases the CPU, upload and download requirements of participant devices.

The application has conservative defaults:

```env
PM_MAX_CONCURRENT_MEETINGS=8
PM_MAX_TOTAL_PARTICIPANTS=60
PM_MAX_ROOM_PARTICIPANTS=12
PM_LECTURE_THRESHOLD=9
PM_MAX_STAGE=4
```

These values are application safety limits, not guaranteed capacity figures.

For detailed discussion:

```text
docs/LIMITS.md
```

For the architecture:

```text
docs/ARCHITECTURE.md
```

---

# Security

The current source includes:

- scrypt password hashing
- Per-user password salts
- Session cookies
- Login rate limiting
- Account activation controls
- Subscription expiry checks
- Admin authorization
- Room authorization
- UFW configuration in the installer
- systemd service hardening
- Caddy security headers

Before production use, perform a separate security review and penetration test.

---

# Important current repository limitations

This section intentionally documents what is **actually present in the current source tree** rather than claiming features that have not been implemented.

### Host dashboard

`login.html` currently redirects non-admin users to:

```text
/dashboard.html
```

but `public/dashboard.html` is not currently present in this repository.

The room, authentication API and administrative interface are present, but a dedicated host dashboard still needs to be added.

### Frontend API helper

The current source does not contain a separate:

```text
public/js/api.js
```

module. API calls are currently made directly from the relevant pages/scripts.

### Favicon

`room.html` references:

```text
/assets/favicon.svg
```

but the current repository does not contain that asset.

These are small repository-completeness issues that should be resolved before calling the application a finished release.

---

# Development roadmap

Potential next steps:

1. Add the missing host dashboard.
2. Add the referenced favicon asset.
3. Add automated browser/WebRTC tests.
4. Test room creation and joining end-to-end.
5. Test TURN connectivity.
6. Harden and test the SFU.
7. Add client-side recording.
8. Add breakout rooms.
9. Add polls and quizzes.
10. Add attendance export.
11. Add billing integration.
12. Perform security review.
13. Load-test different room sizes and devices.

---

# Contributing

Create a feature branch:

```bash
git checkout -b feature/my-feature
```

Make changes and test them.

Then:

```bash
git add .
git commit -m "Describe the change"
git push origin feature/my-feature
```

Open a Pull Request on GitHub.

---

# License

PicoMeet is intended to be distributed under:

**AGPL-3.0-or-later**

See `LICENSE` for the repository's license notice.

---

# Project documentation

Additional documentation is available in:

```text
docs/ARCHITECTURE.md
docs/LIMITS.md
docs/API.md
DEVELOPMENT-WINDOWS.md
sfu/README.md
```

---

## PicoMeet

Lightweight WebRTC conferencing and classroom infrastructure designed for self-hosting.
