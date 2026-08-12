# Architecture

PicoMeet is deliberately split into a tiny signalling/control plane and browser-to-browser
media plane.

## Runtime

- Caddy terminates HTTPS and reverse-proxies to Node.js.
- Node.js serves static files, REST APIs and `/ws` WebSocket signalling.
- SQLite runs in-process with WAL mode.
- WebRTC media normally flows directly between browsers using DTLS-SRTP.
- coturn is optional for users whose networks cannot establish a direct WebRTC path.
- The optional Go/Pion SFU is an upgrade path for larger lecture rooms.

## Core principle

The Node.js server relays signalling messages (SDP, ICE, presence and chat) but does not
normally carry the media stream. This is what keeps server bandwidth low.

## Adaptive Mesh Governor

`server/signaling.js` computes a room quality contract from participant count and mode.
The contract controls resolution, frame rate, bitrate, audio bitrate and the number of
active publishers.

Lecture Mode uses "silent peers": students who are not on stage do not create media
connections until they are invited onto the stage.

## Data ownership

Persistent data lives in SQLite. Live room state lives in Node.js memory. A process restart
therefore ends live meetings by design.

## Scaling model

The supplied design is intentionally single-process. If one machine is exceeded, the
document proposes sharding by deployment/domain rather than adding Redis or a distributed
room-state layer.
