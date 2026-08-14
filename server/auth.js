'use strict';
const crypto = require('crypto');
const { S, now, log } = require('./db');
const cfg = require('./config');
const COOKIE = 'pm_s';
/* --------------------------- password hashing --------------------------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });
  return `s1$${salt.toString('hex')}$${h.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [v, s, h] = String(stored).split('$');
    if (v !== 's1') return false;
    const calc = crypto.scryptSync(String(pw), Buffer.from(s, 'hex'), 32, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'));
  } catch { return false; }
}
/* -------------------------------- cookies -------------------------------- */
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setSessionCookie(res, token, maxAgeSec) {
  const secure = cfg.PUBLIC_URL.startsWith('https') ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
/* ------------------------------- sessions ------------------------------- */
function createSession(user, ua) {
  const token = crypto.randomBytes(32).toString('hex');
  const t = now();
  S.sessInsert.run(token, user.id, t, t + cfg.SESSION_DAYS * 86400, (ua || '').slice(0, 180));
  return token;
}
function userFromToken(token) {
  if (!token || typeof token !== 'string' || token.length !== 64) return null;
  const row = S.sessGet.get(token);
  if (!row) return null;
  if (row.sess_expires_at < now()) { S.sessDelete.run(token); return null; }  // session expiry
  if (!row.active) return null;                                               // account disabled
  if (row.expires_at && row.expires_at < now()) return null;                  // subscription expiry
  return row;
}
function subscriptionValid(u) {
  return !!u && !!u.active && (!u.expires_at || u.expires_at > now());
}
function fromRequest(req) {
  return userFromToken(parseCookies(req)[COOKIE]);
}
/* ------------------------- simple IP rate limiter ------------------------ */
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || t > b.reset) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
  b.n++;
  if (buckets.size > 5000) buckets.clear();       // hard memory ceiling
  return b.n <= max;
}
module.exports = {
  COOKIE, hashPassword, verifyPassword, parseCookies, setSessionCookie,
  clearSessionCookie, createSession, userFromToken, fromRequest,
  subscriptionValid, rateLimit, log
};
