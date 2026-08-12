'use strict';
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const cfg = require('./config');
const { S, now, log } = require('./db');
const auth = require('./auth');
const { iceServers } = require('./ice');
/* =========================================================================
 * ADAPTIVE MESH GOVERNOR
 * The server never sees a video byte — but it *does* decide the physics of
 * the mesh. Given live room state it computes a quality contract that every
 * browser must honour. This is what keeps 1 vCPU clients and home uplinks
 * alive as a room grows.
 * ========================================================================= */
const LADDER = [
  { upto: 2,   w: 1280, h: 720, fps: 30, kbps: 1400 },
  { upto: 4,   w: 960,  h: 540, fps: 25, kbps: 800  },
  { upto: 6,   w: 640,  h: 360, fps: 20, kbps: 450  },
  { upto: 9,   w: 480,  h: 270, fps: 15, kbps: 280  },
  { upto: 12,  w: 320,  h: 180, fps: 12, kbps: 160  },
  { upto: 999, w: 320,  h: 180, fps: 10, kbps: 120  }
];
const SCREEN = { w: 1600, h: 900, fps: 8, kbps: 700 };
function computePolicy(room) {
  const n = room.peers.size;
  const rung = LADDER.find(r => n <= r.upto);
  const lecture = room.mode === 'lecture' || (room.mode === 'auto' && n > cfg.LECTURE_THRESHOLD);
  return {
    n,
    mode: lecture ? 'lecture' : 'seminar',
    video: { w: rung.w, h: rung.h, fps: rung.fps, kbps: rung.kbps },
    screen: SCREEN,
    audioKbps: n > 6 ? 20 : 32,
    // In lecture mode only "stage" peers publish media at all. Everyone else is
    // a Silent Peer: presence + chat over WS, zero PeerConnections. This is the
    // single biggest scalability trick in PicoMeet.
    maxStage: lecture ? cfg.MAX_STAGE : Math.min(n, cfg.MAX_ROOM_PARTICIPANTS),
    stage: lecture ? [...room.stage] : null
  };
}
/* ========================= in-memory room registry ======================= */
/** code -> { code, rec, ownerId, mode, cap, peers:Map, lobby:Map, stage:Set,
 *            locked, meetingId, startedAt, peak, pSeconds, bytes, chat[] }  */
const rooms = new Map();
const uid = () => crypto.randomBytes(6).toString('hex');
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
function sendTo(peer, type, data) {
  if (!peer || peer.ws.readyState !== 1) return;
  const msg = JSON.stringify({ t: type, ...data });
  peer.room.bytes += msg.length;
  try { peer.ws.send(msg); } catch {}
}
function broadcast(room, type, data, exceptId) {
  for (const p of room.peers.values()) if (p.id !== exceptId) sendTo(p, type, data);
}
function roster(room) {
  return [...room.peers.values()].map(p => ({
    id: p.id, name: p.name, role: p.role, onStage: room.stage.has(p.id), st: p.st
  }));
}
function pushPolicy(room) {
  const pol = computePolicy(room);
  room.policy = pol;
  broadcast(room, 'policy', { policy: pol, peers: roster(room) });
}
/* ------------------------------ lifecycle ------------------------------- */
function openRoom(rec, owner) {
  const room = {
    code: rec.code, rec, ownerId: rec.owner_id,
    mode: rec.mode || 'auto',
    cap: Math.min(rec.max_participants || owner.max_participants, owner.max_participants, cfg.MAX_ROOM_PARTICIPANTS),
    maxMinutes: owner.max_minutes || 0,
    peers: new Map(), lobby: new Map(), stage: new Set(),
    locked: false, chat: [],
    startedAt: now(), peak: 0, pSeconds: 0, bytes: 0, policy: null, timer: null
  };
  room.meetingId = S.meetStart.run(rec.id, rec.code, rec.owner_id, room.startedAt).lastInsertRowid;
  S.roomTouch.run(now(), rec.id);
  rooms.set(room.code, room);
  if (room.maxMinutes > 0) {
    room.timer = setTimeout(() => endRoom(room.code,
      `Meeting time limit reached (${room.maxMinutes} min)`), room.maxMinutes * 60000);
    room.timer.unref();
  }
  log(owner.username, 'meeting.start', { code: room.code });
  return room;
}
function closeRoom(room) {
  if (room.timer) clearTimeout(room.timer);
  S.meetEnd.run(now(), room.peak, room.pSeconds, room.bytes, room.meetingId);
  rooms.delete(room.code);
}
function removePeer(room, peer, reason) {
  if (!room.peers.has(peer.id)) return;
  room.pSeconds += Math.max(0, now() - peer.joinedAt);
  room.peers.delete(peer.id);
  room.stage.delete(peer.id);
  broadcast(room, 'bye', { id: peer.id, reason });
  if (room.peers.size === 0) closeRoom(room);
  else {
    // Promote a co-host / longest-present peer if the host vanished.
    if (![...room.peers.values()].some(p => p.role === 'host')) {
      const next = [...room.peers.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) { next.role = 'host'; sendTo(next, 'you', { role: 'host' }); }
    }
    pushPolicy(room);
  }
}
/* ============================ WebSocket server =========================== */
function attach(server) {
  const wss = new WebSocketServer({
    server, path: '/ws',
    maxPayload: 96 * 1024,
    perMessageDeflate: false,      // zlib contexts are RAM murder on 1 GB
    clientTracking: true
  });
  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.peer = null;
    const kill = (code, msg) => {
      try { ws.send(JSON.stringify({ t: 'error', code, msg })); } catch {}
      setTimeout(() => { try { ws.close(4000 + (code % 900)); } catch {} }, 40);
    };
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      if (ws.peer) ws.peer.room.bytes += raw.length;
      try { handle(ws, req, m, kill); }
      catch (e) { console.error('[ws]', e.message); }
    });
    ws.on('close', () => {
      const p = ws.peer;
      if (!p) return;
      if (p.inLobby) { p.room.lobby.delete(p.id); notifyLobby(p.room); return; }
      removePeer(p.room, p, 'left');
    });
    ws.on('error', () => {});
  });
  // Heartbeat: reclaim zombie sockets (mobile users lose signal constantly)
  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 25000);
  hb.unref();
  return wss;
}
function notifyLobby(room) {
  const waiting = [...room.lobby.values()].map(p => ({ id: p.id, name: p.name }));
  for (const p of room.peers.values())
    if (p.role === 'host' || p.role === 'cohost') sendTo(p, 'lobby', { waiting });
}
/* ------------------------------ message router --------------------------- */
function handle(ws, req, m, kill) {
  if (m.t === 'join') return doJoin(ws, req, m, kill);
  const p = ws.peer;
  if (!p || p.inLobby) return;
  const room = p.room;
  switch (m.t) {
    /* ---- pure relay: SDP + ICE. Server never parses media. ---- */
    case 'signal': {
      const dst = room.peers.get(String(m.to));
      if (!dst) return;
      sendTo(dst, 'signal', { from: p.id, data: m.data });
      return;
    }
    /* ---- presence state: mic/cam/screen/hand/speaking ---- */
    case 'state': {
      p.st = {
        mic: !!m.mic, cam: !!m.cam, screen: !!m.screen,
        hand: !!m.hand, speaking: !!m.speaking
      };
      if (p.st.screen || p.st.cam || p.st.mic) room.stage.add(p.id);
      else if (room.policy && room.policy.mode === 'lecture' && p.role === 'guest') room.stage.delete(p.id);
      broadcast(room, 'state', { id: p.id, st: p.st }, p.id);
      return;
    }
    /* ---- chat over WS (tiny, ordered, works for late joiners) ---- */
    case 'chat': {
      const text = clean(m.text, 800);
      if (!text) return;
      const msg = { id: uid(), from: p.id, name: p.name, text, at: Date.now() };
      room.chat.push(msg);
      if (room.chat.length > 60) room.chat.shift();
      broadcast(room, 'chat', msg);
      return;
    }
    /* ---- reactions / raise hand ---- */
    case 'react': {
      broadcast(room, 'react', { id: p.id, e: clean(m.e, 4) });
      return;
    }
    /* ---- host / co-host controls ---- */
    case 'host': {
      if (p.role !== 'host' && p.role !== 'cohost') return;
      const target = m.id ? room.peers.get(String(m.id)) : null;
      switch (m.a) {
        case 'mute':        if (target) sendTo(target, 'cmd', { a: 'mute', by: p.name }); break;
        case 'camoff':      if (target) sendTo(target, 'cmd', { a: 'camoff', by: p.name }); break;
        case 'muteall':
          for (const x of room.peers.values())
            if (x.id !== p.id && x.role === 'guest') sendTo(x, 'cmd', { a: 'mute', by: p.name });
          break;
        case 'kick':
          if (target && target.role !== 'host') {
            sendTo(target, 'error', { code: 403, msg: `Removed by ${p.name}` });
            removePeer(room, target, 'removed');
            setTimeout(() => { try { target.ws.close(4003); } catch {} }, 60);
          }
          break;
        case 'promote':     if (target) { target.role = 'cohost'; sendTo(target, 'you', { role: 'cohost' }); pushPolicy(room); } break;
        case 'demote':      if (target) { target.role = 'guest'; sendTo(target, 'you', { role: 'guest' }); pushPolicy(room); } break;
        case 'stage':       if (target) { room.stage.add(target.id); sendTo(target, 'cmd', { a: 'stage-invite', by: p.name }); pushPolicy(room); } break;
        case 'unstage':     if (target) { room.stage.delete(target.id); sendTo(target, 'cmd', { a: 'stage-remove' }); pushPolicy(room); } break;
        case 'lock':        room.locked = !!m.v; broadcast(room, 'room', { locked: room.locked }); break;
        case 'mode':
          if (['auto', 'seminar', 'lecture'].includes(m.v)) { room.mode = m.v; pushPolicy(room); }
          break;
        case 'spotlight':   broadcast(room, 'spotlight', { id: target ? target.id : null }); break;
        case 'admit': {
          const w = room.lobby.get(String(m.id));
          if (w) { room.lobby.delete(w.id); admit(w); notifyLobby(room); }
          break;
        }
        case 'deny': {
          const w = room.lobby.get(String(m.id));
          if (w) { room.lobby.delete(w.id); sendTo(w, 'error', { code: 403, msg: 'Host declined your request to join' }); try { w.ws.close(4003); } catch {} notifyLobby(room); }
          break;
        }
        case 'end':
          if (p.role === 'host') endRoom(room.code, `Ended by ${p.name}`);
          break;
      }
      return;
    }
    case 'ping': sendTo(p, 'pong', { ts: m.ts }); return;
  }
}
/* --------------------------------- join --------------------------------- */
function doJoin(ws, req, m, kill) {
  if (ws.peer) return;
  const code = clean(m.room, 40).toLowerCase();
  const rec = S.roomByCode.get(code);
  if (!rec) return kill(404, 'Meeting code not found');
  const owner = S.userById.get(rec.owner_id);
  if (!auth.subscriptionValid(owner))
    return kill(402, 'This meeting is unavailable (host account inactive or expired)');
  // Who are you?
  const cookies = auth.parseCookies(req);
  const user = auth.userFromToken(cookies[auth.COOKIE]);
  const isOwner = user && (user.id === rec.owner_id || user.role === 'admin');
  if (!isOwner) {
    if (!rec.guest_ok && !user) return kill(401, 'This meeting requires a PicoMeet account');
    if (rec.pin && clean(m.pin, 8) !== rec.pin) return kill(401, 'Wrong meeting PIN');
  }
  let room = rooms.get(code);
  // ---- server-wide + per-account guardrails ----
  if (!room) {
    if (!isOwner && !user) {
      // Guests may not *start* a meeting; the host opens the door.
      return kill(409, 'The host has not started this meeting yet');
    }
    if (rooms.size >= cfg.MAX_CONCURRENT_MEETINGS)
      return kill(503, 'Server is at its meeting limit. Please try again shortly.');
    const ownerLive = [...rooms.values()].filter(r => r.ownerId === rec.owner_id).length;
    if (ownerLive >= owner.max_rooms)
      return kill(429, `Your plan allows ${owner.max_rooms} simultaneous meeting(s). Close another meeting first.`);
    room = openRoom(rec, owner);
  }
  if (room.locked && !isOwner) return kill(423, 'The meeting is locked');
  if (room.peers.size >= room.cap)
    return kill(429, `This room is full (${room.cap} participants max)`);
  const total = [...rooms.values()].reduce((a, r) => a + r.peers.size, 0);
  if (total >= cfg.MAX_TOTAL_PARTICIPANTS)
    return kill(503, 'Server capacity reached. Please try again shortly.');
  const peer = {
    id: uid(),
    name: clean(user ? user.display_name : m.name, 32) || 'Guest',
    role: isOwner ? 'host' : 'guest',
    userId: user ? user.id : null,
    st: { mic: false, cam: false, screen: false, hand: false, speaking: false },
    joinedAt: now(), room, ws, inLobby: false
  };
  ws.peer = peer;
  // Lobby / knock
  if (rec.knock && !isOwner && room.peers.size > 0) {
    peer.inLobby = true;
    room.lobby.set(peer.id, peer);
    sendTo(peer, 'waiting', { room: rec.name });
    notifyLobby(room);
    return;
  }
  admit(peer);
}
function admit(peer) {
  const room = peer.room;
  peer.inLobby = false;
  if (room.peers.size >= room.cap) { sendTo(peer, 'error', { code: 429, msg: 'Room filled up' }); try { peer.ws.close(4029); } catch {} return; }
  room.peers.set(peer.id, peer);
  room.peak = Math.max(room.peak, room.peers.size);
  if (peer.role === 'host' || peer.role === 'cohost') room.stage.add(peer.id);
  sendTo(peer, 'welcome', {
    self: { id: peer.id, name: peer.name, role: peer.role },
    room: { code: room.code, name: room.rec.name, cap: room.cap, locked: room.locked,
            maxMinutes: room.maxMinutes, startedAt: room.startedAt },
    peers: roster(room).filter(x => x.id !== peer.id),
    policy: computePolicy(room),
    ice: iceServers(peer.id),
    chat: room.chat.slice(-30)
  });
  broadcast(room, 'hello', { peer: { id: peer.id, name: peer.name, role: peer.role, st: peer.st } }, peer.id);
  pushPolicy(room);
  notifyLobby(room);
}
/* ------------------------------ admin hooks ------------------------------ */
function endRoom(code, reason) {
  const room = rooms.get(String(code).toLowerCase());
  if (!room) return false;
  broadcast(room, 'error', { code: 410, msg: reason || 'Meeting ended' });
  for (const p of [...room.peers.values(), ...room.lobby.values()])
    setTimeout(() => { try { p.ws.close(4010); } catch {} }, 80);
  room.pSeconds += [...room.peers.values()].reduce((a, p) => a + (now() - p.joinedAt), 0);
  room.peers.clear(); room.lobby.clear();
  closeRoom(room);
  return true;
}
function endRoomsOfOwner(ownerId, reason) {
  for (const r of [...rooms.values()]) if (r.ownerId === ownerId) endRoom(r.code, reason);
}
const roomLive = code => { const r = rooms.get(String(code).toLowerCase()); return r ? r.peers.size : 0; };
function liveRooms() {
  return [...rooms.values()].map(r => ({
    code: r.code, name: r.rec.name, owner: (S.userById.get(r.ownerId) || {}).username,
    n: r.peers.size, cap: r.cap, mode: (r.policy && r.policy.mode) || r.mode,
    locked: r.locked, startedAt: r.startedAt, kb: Math.round(r.bytes / 1024),
    peers: [...r.peers.values()].map(p => ({ id: p.id, name: p.name, role: p.role }))
  }));
}
const liveStats = () => ({
  meetings: rooms.size,
  participants: [...rooms.values()].reduce((a, r) => a + r.peers.size, 0)
});
const serverLimits = () => ({
  maxMeetings: cfg.MAX_CONCURRENT_MEETINGS,
  maxParticipants: cfg.MAX_TOTAL_PARTICIPANTS,
  maxRoomParticipants: cfg.MAX_ROOM_PARTICIPANTS,
  lectureThreshold: cfg.LECTURE_THRESHOLD
});
module.exports = { attach, endRoom, endRoomsOfOwner, roomLive, liveRooms, liveStats, serverLimits };
