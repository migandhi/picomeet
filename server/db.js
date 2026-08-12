'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const cfg = require('./config');
fs.mkdirSync(path.dirname(cfg.DB_PATH), { recursive: true });
const db = new Database(cfg.DB_PATH);
// Tuned for a 1 GB droplet: WAL for concurrency, tiny page cache, no fsync storms.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -4000');      // ~4 MB
db.pragma('busy_timeout = 5000');
db.pragma('temp_store = MEMORY');
/* ------------------------------ migrations ------------------------------ */
db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER PRIMARY KEY)');
const dir = path.join(__dirname, 'migrations');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const applied = new Set(db.prepare('SELECT v FROM schema_version').all().map(r => r.v));
for (const f of files) {
  const v = parseInt(f, 10);
  if (applied.has(v)) continue;
  db.transaction(() => {
    db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    db.prepare('INSERT INTO schema_version (v) VALUES (?)').run(v);
  })();
  console.log(`[db] migration ${f} applied`);
}
const now = () => Math.floor(Date.now() / 1000);
const q = sql => db.prepare(sql);
/* -------------------------------- queries -------------------------------- */
const S = {
  userByName: q('SELECT * FROM users WHERE username = ?'),
  userById: q('SELECT * FROM users WHERE id = ?'),
  usersAll: q('SELECT * FROM users ORDER BY created_at DESC'),
  userInsert: q(`INSERT INTO users (username,display_name,pass,role,active,plan,max_rooms,
                 max_participants,max_minutes,expires_at,notes,created_at)
                 VALUES (@username,@display_name,@pass,@role,@active,@plan,@max_rooms,
                 @max_participants,@max_minutes,@expires_at,@notes,@created_at)`),
  userDelete: q('DELETE FROM users WHERE id = ?'),
  userPass: q('UPDATE users SET pass = ? WHERE id = ?'),
  roomByCode: q('SELECT * FROM rooms WHERE code = ?'),
  roomsByOwner: q('SELECT * FROM rooms WHERE owner_id = ? ORDER BY last_used_at DESC, id DESC'),
  roomsAll: q(`SELECT r.*, u.username AS owner FROM rooms r
               JOIN users u ON u.id = r.owner_id ORDER BY r.id DESC`),
  roomInsert: q(`INSERT INTO rooms (code,name,owner_id,mode,max_participants,guest_ok,knock,pin,persistent,created_at)
                 VALUES (@code,@name,@owner_id,@mode,@max_participants,@guest_ok,@knock,@pin,@persistent,@created_at)`),
  roomDelete: q('DELETE FROM rooms WHERE id = ? AND owner_id = ?'),
  roomTouch: q('UPDATE rooms SET last_used_at = ? WHERE id = ?'),
  roomCountByOwner: q('SELECT COUNT(*) c FROM rooms WHERE owner_id = ?'),
  sessInsert: q('INSERT INTO sessions (token,user_id,created_at,expires_at,ua) VALUES (?,?,?,?,?)'),
  sessGet: q(`SELECT s.token, s.expires_at, u.* FROM sessions s
              JOIN users u ON u.id = s.user_id WHERE s.token = ?`),
  sessDelete: q('DELETE FROM sessions WHERE token = ?'),
  sessPurge: q('DELETE FROM sessions WHERE expires_at < ?'),
  sessDeleteUser: q('DELETE FROM sessions WHERE user_id = ?'),
  meetStart: q(`INSERT INTO meetings (room_id,code,owner_id,started_at) VALUES (?,?,?,?)`),
  meetEnd: q(`UPDATE meetings SET ended_at=?, peak_participants=?, participant_seconds=?,
              signaling_bytes=? WHERE id = ?`),
  meetRecent: q('SELECT * FROM meetings ORDER BY started_at DESC LIMIT ?'),
  meetUsage: q(`SELECT COUNT(*) meetings, COALESCE(SUM(participant_seconds),0) psec,
                COALESCE(SUM(signaling_bytes),0) bytes FROM meetings WHERE started_at > ?`),
  audit: q('INSERT INTO audit (at,actor,action,detail) VALUES (?,?,?,?)'),
  auditRecent: q('SELECT * FROM audit ORDER BY id DESC LIMIT ?'),
  setGet: q('SELECT v FROM settings WHERE k = ?'),
  setPut: q('INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
};
function log(actor, action, detail) {
  try { S.audit.run(now(), String(actor || '-'), action, detail ? JSON.stringify(detail) : null); }
  catch (e) { /* never let audit break a request */ }
}
// Housekeeping every 6 h — cheap, keeps the file tiny.
setInterval(() => {
  try { S.sessPurge.run(now()); db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) {}
}, 6 * 3600 * 1000).unref();
module.exports = { db, S, now, log };
