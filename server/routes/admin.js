'use strict';
const cfg = require('../config');
const { db } = require('../db');
const { S, now, log } = require('../db');
const auth = require('../auth');
const { Router, json, readJson } = require('../http');
const signaling = require('../signaling');
const billing = require('../modules/billing');
const r = new Router();
function admin(req, res) {
  const u = auth.fromRequest(req);
  if (!u || u.role !== 'admin') { json(res, 403, { error: 'Admin only' }); return null; }
  return u;
}
const view = u => ({
  id: u.id, username: u.username, name: u.display_name, role: u.role, active: !!u.active,
  plan: u.plan, maxRooms: u.max_rooms, maxParticipants: u.max_participants,
  maxMinutes: u.max_minutes, expiresAt: u.expires_at, notes: u.notes, createdAt: u.created_at
});
r.get('/api/admin/users', async (req, res) => {
  if (!admin(req, res)) return;
  json(res, 200, { users: S.usersAll.all().map(view) });
});
r.post('/api/admin/users', async (req, res) => {
  const me = admin(req, res); if (!me) return;
  const b = await readJson(req);
  const username = String(b.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return json(res, 400, { error: 'Username: 3-32 chars a-z 0-9 . _ -' });
  if (!b.password || String(b.password).length < 8) return json(res, 400, { error: 'Password must be 8+ characters' });
  if (S.userByName.get(username)) return json(res, 409, { error: 'Username already exists' });
  const rec = {
    username,
    display_name: String(b.name || username).slice(0, 60),
    pass: auth.hashPassword(b.password),
    role: ['admin', 'host', 'user'].includes(b.role) ? b.role : 'host',
    active: b.active === false ? 0 : 1,
    plan: String(b.plan || 'basic').slice(0, 24),
    max_rooms: Math.max(1, Math.min(Number(b.maxRooms) || 1, cfg.MAX_CONCURRENT_MEETINGS)),
    max_participants: Math.max(2, Math.min(Number(b.maxParticipants) || 8, cfg.MAX_ROOM_PARTICIPANTS)),
    max_minutes: Math.max(0, Number(b.maxMinutes) || 0),
    expires_at: b.expiresAt ? Number(b.expiresAt) : null,
    notes: b.notes ? String(b.notes).slice(0, 500) : null,
    created_at: now()
  };
  const info = S.userInsert.run(rec);
  log(me.username, 'user.create', { username, role: rec.role });
  billing.onAccountCreated({ id: info.lastInsertRowid, ...rec });   // no-op stub
  json(res, 200, { user: view(S.userById.get(info.lastInsertRowid)) });
});
r.patch('/api/admin/users/:id', async (req, res) => {
  const me = admin(req, res); if (!me) return;
  const u = S.userById.get(Number(req.params.id));
  if (!u) return json(res, 404, { error: 'No such user' });
  const b = await readJson(req);
  const map = {
    name: ['display_name', v => String(v).slice(0, 60)],
    role: ['role', v => (['admin', 'host', 'user'].includes(v) ? v : u.role)],
    active: ['active', v => (v ? 1 : 0)],
    plan: ['plan', v => String(v).slice(0, 24)],
    maxRooms: ['max_rooms', v => Math.max(1, Math.min(Number(v) || 1, cfg.MAX_CONCURRENT_MEETINGS))],
    maxParticipants: ['max_participants', v => Math.max(2, Math.min(Number(v) || 8, cfg.MAX_ROOM_PARTICIPANTS))],
    maxMinutes: ['max_minutes', v => Math.max(0, Number(v) || 0)],
    expiresAt: ['expires_at', v => (v ? Number(v) : null)],
    notes: ['notes', v => (v ? String(v).slice(0, 500) : null)]
  };
  const sets = [], vals = [];
  for (const k of Object.keys(map)) {
    if (b[k] === undefined) continue;
    sets.push(`${map[k][0]} = ?`); vals.push(map[k][1](b[k]));
  }
  if (sets.length) { db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, u.id); }
  if (b.password) {
    if (String(b.password).length < 8) return json(res, 400, { error: 'Password must be 8+ characters' });
    S.userPass.run(auth.hashPassword(b.password), u.id);
    S.sessDeleteUser.run(u.id);                       // force re-login everywhere
  }
  // Disabling / expiring an account instantly boots their live meetings.
  const fresh = S.userById.get(u.id);
  if (!auth.subscriptionValid(fresh)) signaling.endRoomsOfOwner(fresh.id, 'Account suspended by administrator');
  log(me.username, 'user.update', { username: fresh.username, fields: Object.keys(b) });
  json(res, 200, { user: view(fresh) });
});
r.delete('/api/admin/users/:id', async (req, res) => {
  const me = admin(req, res); if (!me) return;
  const u = S.userById.get(Number(req.params.id));
  if (!u) return json(res, 404, { error: 'No such user' });
  if (u.role === 'admin' && S.usersAll.all().filter(x => x.role === 'admin').length <= 1)
    return json(res, 400, { error: 'Cannot delete the last admin' });
  signaling.endRoomsOfOwner(u.id, 'Account removed');
  S.userDelete.run(u.id);
  log(me.username, 'user.delete', { username: u.username });
  json(res, 200, { ok: true });
});
/* ------------------------------ live / stats ---------------------------- */
r.get('/api/admin/live', async (req, res) => {
  if (!admin(req, res)) return;
  const m = process.memoryUsage();
  json(res, 200, {
    rooms: signaling.liveRooms(),
    limits: signaling.serverLimits(),
    server: { rssMB: +(m.rss / 1048576).toFixed(1), uptime: Math.round(process.uptime()) },
    usage30d: S.meetUsage.get(now() - 30 * 86400),
    recent: S.meetRecent.all(20),
    rooms_db: S.roomsAll.all().length
  });
});
r.post('/api/admin/rooms/:code/end', async (req, res) => {
  const me = admin(req, res); if (!me) return;
  signaling.endRoom(req.params.code, 'Ended by administrator');
  log(me.username, 'room.force_end', { code: req.params.code });
  json(res, 200, { ok: true });
});
r.get('/api/admin/audit', async (req, res) => {
  if (!admin(req, res)) return;
  json(res, 200, { audit: S.auditRecent.all(100) });
});
module.exports = r;
