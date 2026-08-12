#!/usr/bin/env node
'use strict';
const readline = require('readline');
const { S, db, now } = require('./db');
const auth = require('./auth');
const cfg = require('./config');
const [, , cmd, ...args] = process.argv;
const ask = (q, hide = false) => new Promise(r => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hide) { rl.output.write(q); rl._writeToOutput = () => {}; rl.question('', a => { rl.close(); process.stdout.write('\n'); r(a); }); }
  else rl.question(q, a => { rl.close(); r(a); });
});
async function main() {
  switch (cmd) {
    case 'create-admin':
    case 'create-user': {
      const role = cmd === 'create-admin' ? 'admin' : (args[2] || 'host');
      const username = (args[0] || await ask('username: ')).trim().toLowerCase();
      const password = args[1] || await ask('password: ', true);
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('bad username');
      if (String(password).length < 8) throw new Error('password must be 8+ chars');
      if (S.userByName.get(username)) throw new Error('user exists');
      S.userInsert.run({
        username, display_name: username, pass: auth.hashPassword(password), role,
        active: 1, plan: role === 'admin' ? 'campus' : 'basic',
        max_rooms: role === 'admin' ? cfg.MAX_CONCURRENT_MEETINGS : 1,
        max_participants: cfg.MAX_ROOM_PARTICIPANTS, max_minutes: 0,
        expires_at: null, notes: 'created via CLI', created_at: now()
      });
      console.log(`✔ ${role} "${username}" created`);
      break;
    }
    case 'passwd': {
      const username = (args[0] || await ask('username: ')).trim().toLowerCase();
      const password = args[1] || await ask('new password: ', true);
      const u = S.userByName.get(username); if (!u) throw new Error('no such user');
      S.userPass.run(auth.hashPassword(password), u.id);
      S.sessDeleteUser.run(u.id);
      console.log('✔ password changed, all sessions revoked');
      break;
    }
    case 'list-users':
      console.table(S.usersAll.all().map(u => ({
        id: u.id, user: u.username, role: u.role, plan: u.plan, active: !!u.active,
        rooms: u.max_rooms, seats: u.max_participants,
        expires: u.expires_at ? new Date(u.expires_at * 1000).toISOString().slice(0, 10) : '—'
      })));
      break;
    case 'stats': {
      const u = S.meetUsage.get(now() - 30 * 86400);
      console.log(`Last 30 days: ${u.meetings} meetings, ${(u.psec / 3600).toFixed(1)} participant-hours, ` +
                  `${(u.bytes / 1048576).toFixed(2)} MB of signalling traffic.`);
      console.log(`Estimated server bandwidth for media: 0 MB (pure P2P mesh).`);
      break;
    }
    case 'backup': {
      const out = args[0] || `./data/backup-${new Date().toISOString().slice(0, 10)}.db`;
      await db.backup(out); console.log('✔ backup →', out);
      break;
    }
    default:
      console.log(`PicoMeet CLI
  node server/cli.js create-admin [user] [pass]
  node server/cli.js create-user  [user] [pass] [host|user]
  node server/cli.js passwd       [user] [pass]
  node server/cli.js list-users
  node server/cli.js stats
  node server/cli.js backup [file.db]`);
  }
}
main().catch(e => { console.error('✖', e.message); process.exit(1); });
