'use strict';
const crypto = require('crypto');
const cfg = require('../config');
const { S, now, log } = require('../db');
const auth = require('../auth');
const { Router, json, readJson } = require('../http');
const { iceServers } = require('../ice');
const signaling = require('../signaling');
const r = new Router();
const publicUser = u => ({
  id: u.id, username: u.username, name: u.display_name, role: u.role, plan: u.plan,
  maxRooms: u.max_rooms, maxParticipants: u.max_participants, maxMinutes: u.max_minutes,
  expiresAt: u.expires_at
});
const ip = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
function newCode() {
  // 9 chars, human-friendly, no ambiguous glyphs: xxx-xxx-xxx
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const p = n => Array.from(crypto.randomBytes(n)).map(b => A[b % A.length]).join('');
  return `${p(3)}-${p(3)}-${p(3)}`;
}
/* --------------------------------- auth --------------------------------- */
r.post('/api/login', async (req, res) => {
  if (!auth.rateLimit('login:' + ip(req), 8, 15 * 60 * 1000))
    return json(res, 429, { error: 'Too many attempts. Wait 15 minutes.' });
  const b = await readJson(req);
  const u = S.userByName.get(String(b.username || '').trim());
  if (!u || !auth.verifyPassword(b.password || '', u.pass))
    return json(res, 401, { error: 'Invalid username or password' });
  if (!auth.subscriptionValid(u))
    return json(res, 403, { error: 'Account inactive or subscription expired' });
  const token = auth.createSession(u, req.headers['user-agent']);
  auth.setSessionCookie(res, token, cfg.SESSION_DAYS * 86400);
  log(u.username, 'login', { ip: ip(req) });
  json(res, 200, { user: publicUser(u) });
});
r.post('/api/logout', async (req, res) => {
  const t = auth.parseCookies(req)[auth.COOKIE];
  if (t) S.sessDelete.run(t);
  auth.clearSessionCookie(res);
  json(res, 200, { ok: true });
});
r.get('/api/me', async (req, res) => {
  const u = auth.fromRequest(req);
  if (!u) return json(res, 401, { error: 'Not signed in' });
  const rooms = S.roomsByOwner.all(u.id).map(x => ({
    code: x.code, name: x.name, mode: x.mode, knock: !!x.knock, guestOk: !!x.guest_ok,
    hasPin: !!x.pin, max: x.max_participants || u.max_participants,
    live: signaling.roomLive(x.code)
  }));
  json(res, 200, { user: publicUser(u), rooms, limits: signaling.serverLimits() });
});
/* --------------------------------- rooms -------------------------------- */
r.post('/api/rooms', async (req, res) => {
  const u = auth.fromRequest(req);
  if (!u || !auth.subscriptionValid(u)) return json(res, 401, { error: 'Not signed in' });
  if (u.role === 'user') return json(res, 403, { error: 'Your account cannot create rooms. Ask the admin for Host privileges.' });
  /* v1.1: anti-spam — max 10 new rooms per hour per account */
  if (!auth.rateLimit('mkroom:' + u.id, 10, 60 * 60 * 1000))
    return json(res, 429, { error: 'Too many rooms created. Try again in an hour.' });
  if (S.roomCountByOwner.get(u.id).c >= Math.max(u.max_rooms * 5, 5))
    return json(res, 403, { error: 'Room list full — delete an old room first.' });
  const b = await readJson(req);
  const room = {
    code: newCode(),
    name: String(b.name || 'Class').slice(0, 60),
    owner_id: u.id,
    mode: ['auto', 'seminar', 'lecture'].includes(b.mode) ? b.mode : 'auto',
    max_participants: Math.min(Number(b.max) || u.max_participants, u.max_participants, cfg.MAX_ROOM_PARTICIPANTS),
    guest_ok: b.guestOk === false ? 0 : 1,
    knock: b.knock ? 1 : 0,
    pin: b.pin ? String(b.pin).replace(/\D/g, '').slice(0, 8) || null : null,
    persistent: 1,
    created_at: now()
  };
  S.roomInsert.run(room);
  log(u.username, 'room.create', { code: room.code });
  json(res, 200, { room: { ...room, url: `${cfg.PUBLIC_URL}/room.html?r=${room.code}` } });
});
r.delete('/api/rooms/:code', async (req, res) => {
  const u = auth.fromRequest(req);
  if (!u) return json(res, 401, { error: 'Not signed in' });
  const room = S.roomByCode.get(req.params.code);
  if (!room) return json(res, 404, { error: 'No such room' });
  if (room.owner_id !== u.id && u.role !== 'admin') return json(res, 403, { error: 'Not yours' });
  signaling.endRoom(room.code, 'Room deleted by owner');
  S.roomDelete.run(room.id, room.owner_id);
  json(res, 200, { ok: true });
});
/* ------------------------- pre-join room lookup ------------------------- */
r.get('/api/room/:code', async (req, res) => {
  const room = S.roomByCode.get(req.params.code);
  if (!room) return json(res, 404, { error: 'Meeting code not found' });
  const owner = S.userById.get(room.owner_id);
  json(res, 200, {
    code: room.code, name: room.name,
    guestOk: !!room.guest_ok, needsPin: !!room.pin, knock: !!room.knock,
    live: signaling.roomLive(room.code),
    ownerActive: auth.subscriptionValid(owner)
  });
});
/* ---------------------------- ICE (STUN/TURN) --------------------------- */
r.get('/api/ice', async (req, res) => {
  json(res, 200, { iceServers: iceServers('pm'), sfu: cfg.SFU_URL || null });
});
/* ------------------------------- health --------------------------------- */
r.get('/api/health', async (req, res) => {
  const m = process.memoryUsage();
  json(res, 200, {
    ok: true, uptime: Math.round(process.uptime()),
    rssMB: Math.round(m.rss / 1048576), heapMB: Math.round(m.heapUsed / 1048576),
    live: signaling.liveStats()
  });
});
module.exports = r;
