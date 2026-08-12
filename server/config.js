'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
// Zero-dependency .env loader
(function loadEnv() {
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();
const num = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
const str = (k, d = '') => (process.env[k] || d).trim();
module.exports = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  DATA_DIR: path.join(ROOT, 'data'),
  PORT: num('PM_PORT', 8080),
  HOST: str('PM_HOST', '127.0.0.1'),
  PUBLIC_URL: str('PM_PUBLIC_URL', 'http://localhost:8080'),
  DB_PATH: path.resolve(ROOT, str('PM_DB', './data/picomeet.db')),
  SECRET: str('PM_SECRET', 'dev-insecure-secret'),
  SESSION_DAYS: num('PM_SESSION_DAYS', 14),
  MAX_CONCURRENT_MEETINGS: num('PM_MAX_CONCURRENT_MEETINGS', 8),
  MAX_TOTAL_PARTICIPANTS: num('PM_MAX_TOTAL_PARTICIPANTS', 60),
  MAX_ROOM_PARTICIPANTS: num('PM_MAX_ROOM_PARTICIPANTS', 12),
  LECTURE_THRESHOLD: num('PM_LECTURE_THRESHOLD', 9),
  MAX_STAGE: num('PM_MAX_STAGE', 4),
  STUN: str('PM_STUN', 'stun:stun.l.google.com:19302').split(',').map(s => s.trim()).filter(Boolean),
  TURN_URL: str('PM_TURN_URL'),
  TURN_SECRET: str('PM_TURN_SECRET'),
  TURN_TTL: num('PM_TURN_TTL', 7200),
  SFU_URL: str('PM_SFU_URL'),
  PROD: process.env.NODE_ENV === 'production'
};
