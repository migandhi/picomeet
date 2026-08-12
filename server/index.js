'use strict';
const http = require('http');
const cfg = require('./config');
const { serveStatic, send, json } = require('./http');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const signaling = require('./signaling');
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  // Short join links:  https://host/j/abc-def-ghi
  if (p.startsWith('/j/')) {
    res.writeHead(302, { Location: '/room.html?r=' + encodeURIComponent(p.slice(3)) });
    return res.end();
  }
  if (p.startsWith('/api/')) {
    try {
      if (await adminRoutes.dispatch(req, res, p)) return;
      if (await apiRoutes.dispatch(req, res, p)) return;
      return json(res, 404, { error: 'Unknown endpoint' });
    } catch (e) {
      console.error('[api]', p, e.message);
      return json(res, 400, { error: e.message || 'Bad request' });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  serveStatic(req, res, p);
});
server.headersTimeout = 20000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 65000;
server.maxHeadersCount = 40;
signaling.attach(server);
server.listen(cfg.PORT, cfg.HOST, () => {
  console.log(`PicoMeet listening on http://${cfg.HOST}:${cfg.PORT}  (public: ${cfg.PUBLIC_URL})`);
  const m = process.memoryUsage();
  console.log(`Boot RSS: ${(m.rss / 1048576).toFixed(1)} MB`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  console.log('shutting down…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
});
process.on('uncaughtException', e => console.error('[uncaught]', e));
process.on('unhandledRejection', e => console.error('[unhandled]', e));
