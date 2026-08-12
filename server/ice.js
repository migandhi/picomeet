'use strict';
const crypto = require('crypto');
const cfg = require('./config');
/**
 * coturn "REST API" / TURN-REST ephemeral credentials.
 * username = <expiry-unix>:<label>   password = base64(HMAC-SHA1(secret, username))
 * Nothing leaves the box; no third-party service involved.
 */
function iceServers(label = 'pm') {
  const list = [{ urls: cfg.STUN }];
  if (cfg.TURN_URL && cfg.TURN_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + cfg.TURN_TTL}:${label}`;
    const credential = crypto.createHmac('sha1', cfg.TURN_SECRET).update(username).digest('base64');
    list.push({ urls: cfg.TURN_URL.split(',').map(s => s.trim()), username, credential });
  }
  return list;
}
module.exports = { iceServers };
