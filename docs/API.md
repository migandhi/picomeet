# API

## Public

- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`
- `GET /api/room/:code`
- `GET /api/ice`
- `GET /api/health`
- `POST /api/rooms`
- `DELETE /api/rooms/:code`

## Admin

- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:id`
- `DELETE /api/admin/users/:id`
- `GET /api/admin/live`
- `POST /api/admin/rooms/:code/end`
- `GET /api/admin/audit`

## WebSocket

The signalling endpoint is:

`/ws`

Messages include room join, SDP/ICE signalling, participant state, chat, reactions,
host controls and ping/pong. The server treats media as opaque WebRTC signalling data.
