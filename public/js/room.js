import { Mesh } from './mesh.js';
import { QualityGovernor } from './quality.js';
import { Board } from './board.js';
import { Recorder } from './recorder.js';

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const code = new URLSearchParams(location.search).get('r') || '';
const S = {
  ws: null, mesh: null, gov: null, self: null, room: null, policy: null,
  peers: new Map(),           // id -> {name, role, st, tile}
  local: null, camTrack: null, screenTrack: null,
  mic: true, cam: true, sharing: false, hand: false,
  ink: null, wb: null, drawing: false, focusId: null, wbOpen: false,
  chat: [], unread: 0, rec: null
};
/* ============================== bootstrap ============================== */
(async function boot() {
  if (!code) return fail('No meeting code in the link.');
  let info;
  try { info = await (await fetch('/api/room/' + encodeURIComponent(code))).json(); }
  catch { return fail('Cannot reach the server.'); }
  if (info.error) return fail(info.error);
  if (!info.ownerActive) return fail('This meeting is unavailable (host account inactive).');

  const me = await fetch('/api/me').then(r => r.json()).catch(() => ({}));

  // Option A: If guests are disallowed and the user is not authenticated, redirect to login
  if (!info.guestOk && !me.user) {
    sessionStorage.setItem('pm_redirect', `/j/${encodeURIComponent(code)}`);
    location.href = `/login.html?msg=${encodeURIComponent('This meeting requires an account to join.')}`;
    return;
  }

  $('#gate-room').textContent = `“${info.name}” · code ${info.code}` + (info.live ? ` · ${info.live} online` : '');
  if (info.needsPin) $('#pin-wrap').hidden = false;
  if (me.user) { $('#g-name').value = me.user.name; $('#g-name').disabled = true; }
  else $('#g-name').value = localStorage.getItem('pm.name') || '';

  try {
    S.local = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    $('#g-preview').srcObject = S.local;
    S.camTrack = S.local.getVideoTracks()[0];
  } catch (e) {
    toast('No camera/mic — you can still join to listen and chat.');
    S.local = new MediaStream();
  }
  $('#g-cam').onchange = e => S.local.getVideoTracks().forEach(t => t.enabled = e.target.checked);
  $('#g-mic').onchange = e => S.local.getAudioTracks().forEach(t => t.enabled = e.target.checked);
  $('#g-join').onclick = join;
  $('#g-name').addEventListener('keydown', e => e.key === 'Enter' && join());
})();

function fail(msg) { $('#gate-msg').textContent = msg; $('#g-join') && ($('#g-join').disabled = true); }

/* ================================ join ================================= */
function join() {
  const name = $('#g-name').value.trim();
  if (!name) return fail('Please enter your name.');
  localStorage.setItem('pm.name', name);
  S.mic = $('#g-mic').checked; S.cam = $('#g-cam').checked;
  S.local.getAudioTracks().forEach(t => t.enabled = S.mic);
  S.local.getVideoTracks().forEach(t => t.enabled = S.cam);
  $('#g-join').disabled = true; $('#gate-msg').textContent = 'Connecting…';
  openSocket(name, $('#g-pin').value.trim());
}

function openSocket(name, pin) {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  const ws = new WebSocket(url);
  S.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room: code, name, pin }));
  ws.onmessage = e => onMessage(JSON.parse(e.data));
  ws.onclose = () => { if (S.self) toast('Disconnected. Reload to rejoin.', 8000); };
  ws.onerror = () => fail('Connection failed.');
}

const wsend = o => S.ws && S.ws.readyState === 1 && S.ws.send(JSON.stringify(o));

/* ========================= signalling messages ========================= */
function onMessage(m) {
  switch (m.t) {
    case 'error':   return fail(m.msg) || toast(m.msg, 9000);
    case 'waiting': return ($('#gate-msg').textContent = 'Waiting for the host to let you in…');
    case 'welcome': {
      S.self = m.self; S.room = m.room; S.policy = m.policy;
      $('#gate').hidden = true;
      document.title = m.room.name + ' · PicoMeet';
      S.mesh = new Mesh({ selfId: S.self.id, ice: m.ice, send: (to, data) => wsend({ t: 'signal', to, data }) });
      S.mesh.addEventListener('stream', e => attachStream(e.detail.id, e.detail.stream));
      S.mesh.addEventListener('dcmsg', e => onDC(e.detail.id, e.detail.data));
      S.mesh.addEventListener('dcopen', e => {
        if (S.wb && S.wb.strokes.length && e.detail.dc.readyState === 'open') {
          const msg = JSON.stringify({ p: 'board', ch: 'wb', ...S.wb.snapshot() });
          try { e.detail.dc.send(msg); } catch {}
        }
      });
      S.mesh.publish(S.local);
      S.gov = new QualityGovernor(S.mesh, r => hud(`${r.h}p · ${r.kbps}kbps`));
      applyPolicy(m.policy);
      addTile(S.self.id, S.self.name + ' (you)', S.local, true);
      m.peers.forEach(p => addPeer(p, true));
      (m.chat || []).forEach(c => pushChat(c, true));
      initBoards(); bindUI(); pushState();
      if (S.self.role !== 'guest') $('#b-host').hidden = false;
      if (S.self.role !== 'guest' && Recorder.supported()) $('#b-rec').hidden = false;
      toast(`Joined “${m.room.name}”. Share: ${location.origin}/j/${m.room.code}`, 7000);
      return;
    }
    case 'hello':  return addPeer(m.peer, true);
    case 'bye':    return removePeer(m.id);
    case 'policy': {
      applyPolicy(m.policy);
      m.peers.forEach(p => { const x = S.peers.get(p.id); if (x) { x.role = p.role; x.onStage = p.onStage; } });
      renderCount(); return;
    }
    case 'signal': return S.mesh && S.mesh.onSignal(m.from, m.data);
    case 'state':  return setPeerState(m.id, m.st);
    case 'chat':   return pushChat(m);
    case 'react':  return flyReaction(m.id, m.e);
    case 'you':    { S.self.role = m.role; $('#b-host').hidden = (m.role === 'guest'); toast('You are now ' + m.role); return; }
    case 'room':   return toast(m.locked ? 'Meeting locked' : 'Meeting unlocked');
    case 'lobby':  return renderLobby(m.waiting);
    case 'spotlight': return m.id ? openFocus(m.id) : closeFocus();
    case 'cmd':    return onHostCmd(m);
  }
}

function onHostCmd(m) {
  if (m.a === 'mute')   { S.mic = false; S.local.getAudioTracks().forEach(t => t.enabled = false); syncButtons(); pushState(); toast(`${m.by} muted you`); }
  if (m.a === 'camoff') { S.cam = false; S.local.getVideoTracks().forEach(t => t.enabled = false); syncButtons(); pushState(); toast(`${m.by} turned off your camera`); }
  if (m.a === 'stage-invite') toast(`${m.by} invited you to speak — unmute when ready`, 8000);
  if (m.a === 'stage-remove') { S.mic = false; S.cam = false; applyTracks(); pushState(); }
}

/* ==================== Adaptive Mesh Governor (client) ================== */
function applyPolicy(p) {
  S.policy = p;
  if (!S.mesh) return;
  S.mesh.setQuality({ ...p.video, audioKbps: p.audioKbps, screen: S.sharing });
  S.gov.setCeiling(p.video);
  if (S.camTrack && !S.sharing) {
    S.camTrack.applyConstraints({
      width: { ideal: p.video.w }, height: { ideal: p.video.h }, frameRate: { ideal: p.video.fps }
    }).catch(() => {});
  }
  document.body.classList.toggle('lecture', p.mode === 'lecture');
  hud(`${p.mode} · ${p.n} people · ${p.video.h}p`);
}

/* ============================== peers/tiles ============================ */
function addPeer(p, connect) {
  if (p.id === S.self.id || S.peers.has(p.id)) return;
  S.peers.set(p.id, { ...p, tile: null });
  addTile(p.id, p.name, null, false);
  if (connect && S.mesh) S.mesh.ensure(p.id);
  setPeerState(p.id, p.st || {});
  renderCount();
}

function removePeer(id) {
  S.mesh && S.mesh.close(id);
  const p = S.peers.get(id);
  if (p && p.tile) p.tile.remove();
  S.peers.delete(id);
  if (S.focusId === id) closeFocus();
  renderCount();
}

function addTile(id, name, stream, isSelf) {
  const tile = el('div', 'tile'); tile.dataset.id = id;
  const v = el('video'); v.autoplay = true; v.playsInline = true; v.muted = isSelf;
  if (stream) v.srcObject = stream;
  const badge = el('div', 'badge'); badge.append(el('span', 'nm', name), el('span', 'ic', ''));
  const av = el('div', 'avatar', (name[0] || '?').toUpperCase());
  tile.append(v, av, badge);
  tile.ondblclick = () => (S.focusId === id ? closeFocus() : openFocus(id));
  $('#grid').append(tile);
  if (isSelf) tile.classList.add('self'); else S.peers.get(id).tile = tile;
  relayout();
  return tile;
}

function attachStream(id, stream) {
  const p = S.peers.get(id); if (!p || !p.tile) return;
  const v = p.tile.querySelector('video');
  if (v.srcObject !== stream) v.srcObject = stream;
  p.tile.classList.toggle('novideo', !stream.getVideoTracks().some(t => t.readyState === 'live'));
  if (S.focusId === id || (p.st && p.st.screen && !S.focusId)) {
    openFocus(id, stream);
  }
}

function setPeerState(id, st) {
  const p = S.peers.get(id); if (!p) return;
  p.st = st;
  if (!p.tile) return;
  p.tile.classList.toggle('muted', !st.mic);
  p.tile.classList.toggle('novideo', !st.cam && !st.screen);
  p.tile.classList.toggle('speaking', !!st.speaking);
  p.tile.classList.toggle('hand', !!st.hand);
  p.tile.querySelector('.ic').textContent =
    (st.hand ? '✋' : '') + (st.screen ? '🖥' : '') + (st.mic ? '' : '🔇');
  if (st.screen && !S.focusId) openFocus(id);
}

function renderCount() {
  $('#b-count').textContent = S.peers.size + 1;
  if ($('#panel').dataset.kind === 'people') renderPeople();
}

function relayout() {
  const n = $('#grid').children.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  $('#grid').style.setProperty('--cols', cols);
}

/* ============================ local media ============================== */
async function applyTracks() {
  S.local.getAudioTracks().forEach(t => t.enabled = S.mic);
  if (!S.sharing) {
    const videoTrack = S.cam ? S.camTrack : null;
    if (S.mesh) await S.mesh.replaceVideo(videoTrack);
  }
  syncButtons();
}

function pushState() {
  wsend({ t: 'state', mic: S.mic, cam: S.cam || S.sharing, screen: S.sharing, hand: S.hand, speaking: S.speaking });
}

function syncButtons() {
  $('#b-mic').classList.toggle('off', !S.mic);
  $('#b-cam').classList.toggle('off', !S.cam);
  $('#b-share').classList.toggle('on', S.sharing);
  $('#b-hand').classList.toggle('on', S.hand);
  $('#b-draw').classList.toggle('on', S.drawing);
}

async function toggleShare() {
  if (S.sharing) {
    S.screenTrack && S.screenTrack.stop();
    S.screenTrack = null; S.sharing = false;
    await S.mesh.replaceVideo(S.camTrack || null);
    applyPolicy(S.policy); closeFocus(); pushState(); syncButtons();
    return;
  }
  try {
    const ds = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 8, max: 15 }, width: { max: 1920 } }, audio: false
    });
    S.screenTrack = ds.getVideoTracks()[0];
    if ('contentHint' in S.screenTrack) S.screenTrack.contentHint = 'detail';
    S.screenTrack.onended = () => S.sharing && toggleShare();
    S.sharing = true;
    await S.mesh.replaceVideo(S.screenTrack);
    S.mesh.setQuality({ ...S.policy.screen, screen: true });
    openFocus(S.self.id, new MediaStream([S.screenTrack]));
    pushState(); syncButtons();
    toast('Sharing your screen. Tap ✏️ to annotate live.');
  } catch { /* user cancelled */ }
}

/* =========================== focus + annotation ======================== */
function openFocus(id, stream) {
  S.focusId = id;
  const src = stream || (id === S.self.id ? S.local : (S.mesh.peers.get(id) || {}).stream);
  $('#focus-video').srcObject = src || null;
  $('#focus-video').muted = (id === S.self.id);
  $('#focus-label').textContent = (id === S.self.id ? 'You' : (S.peers.get(id) || {}).name || '') + ' — presenting';
  $('#focus').hidden = false;
  S.ink && S.ink.resize();
}

function closeFocus() { S.focusId = null; $('#focus').hidden = true; setDraw(false); }

function initBoards() {
  S.ink = new Board($('#ink'), { onStroke: s => sendInk({ ...s, ch: 'ink' }) });
  S.wb  = new Board($('#wb-ink'), { onStroke: s => sendInk({ ...s, ch: 'wb' }) });
}

function sendInk(msg) {
  if (msg.s) msg.s.by = S.self.id;
  msg.by = msg.by || S.self.id;
  S.mesh.broadcastDC({ p: 'board', ...msg });
}

function onDC(from, data) {
  if (typeof data !== 'string') return;
  let m; try { m = JSON.parse(data); } catch { return; }
  if (m.p !== 'board') return;
  (m.ch === 'wb' ? S.wb : S.ink).remote(m);
}

function setDraw(on) {
  S.drawing = on;
  S.ink.enabled = on && !$('#focus').hidden;
  S.wb.enabled = on && !$('#whiteboard').hidden;
  $('#ink').classList.toggle('active', S.ink.enabled);
  $('#wb-ink').classList.toggle('active', S.wb.enabled);
  $('#palette').hidden = !on;
  syncButtons();
}

/* ================================ chat ================================= */
function pushChat(m, silent) {
  S.chat.push(m);
  if ($('#panel').dataset.kind === 'chat') renderChat();
  else if (!silent) { S.unread++; $('#b-chat').dataset.badge = S.unread; toast(`${m.name}: ${m.text.slice(0, 60)}`); }
}

function renderChat() {
  const b = $('#panel-body'); b.innerHTML = '';
  for (const c of S.chat) {
    const d = el('div', 'msg' + (c.from === S.self.id ? ' me' : ''));
    d.append(el('b', null, c.name), el('span', null, c.text));
    b.append(d);
  }
  b.scrollTop = b.scrollHeight;
  S.unread = 0; delete $('#b-chat').dataset.badge;
}

/* ============================ people / host ============================ */
function renderPeople() {
  const b = $('#panel-body'); b.innerHTML = '';
  const host = S.self.role === 'host' || S.self.role === 'cohost';
  const list = [{ id: S.self.id, name: S.self.name + ' (you)', role: S.self.role, st: {} }, ...S.peers.values()];
  for (const p of list) {
    const r = el('div', 'prow');
    r.append(el('span', 'pn', `${p.name}${p.role !== 'guest' ? ' · ' + p.role : ''}`));
    if (host && p.id !== S.self.id) {
      const act = el('span', 'acts');
      for (const [label, a, title] of [['🔇', 'mute', 'Mute'], ['📷', 'camoff', 'Camera off'],
        ['🎤', 'stage', 'Invite to speak'], ['⭐', 'promote', 'Make co-host'], ['⛔', 'kick', 'Remove']]) {
        const btn = el('button', 'mini', label); btn.title = title;
        btn.onclick = () => wsend({ t: 'host', a, id: p.id });
        act.append(btn);
      }
      r.append(act);
    }
    b.append(r);
  }
  if (host) {
    const tools = el('div', 'hosttools');
    const mk = (t, fn) => { const x = el('button', 'ghost', t); x.onclick = fn; tools.append(x); };
    mk('Mute everyone', () => wsend({ t: 'host', a: 'muteall' }));
    mk('Lock meeting', () => wsend({ t: 'host', a: 'lock', v: true }));
    mk('Unlock', () => wsend({ t: 'host', a: 'lock', v: false }));
    mk('Seminar mode', () => wsend({ t: 'host', a: 'mode', v: 'seminar' }));
    mk('Lecture mode', () => wsend({ t: 'host', a: 'mode', v: 'lecture' }));
    mk('Copy invite link', () => navigator.clipboard.writeText(`${location.origin}/j/${S.room.code}`).then(() => toast('Invite link copied')));
    if (S.self.role === 'host') mk('End meeting for all', () => confirm('End for everyone?') && wsend({ t: 'host', a: 'end' }));
    b.append(tools);
  }
}

function renderLobby(waiting) {
  if (!waiting.length) return;
  waiting.forEach(w => {
    toast(`${w.name} wants to join`, 30000, [
      ['Admit', () => wsend({ t: 'host', a: 'admit', id: w.id })],
      ['Deny', () => wsend({ t: 'host', a: 'deny', id: w.id })]
    ]);
  });
}

/* ================================= UI ================================== */
function panel(kind, title) {
  const p = $('#panel');
  if (!p.hidden && p.dataset.kind === kind) { p.hidden = true; return; }
  p.hidden = false; p.dataset.kind = kind; $('#panel-title').textContent = title;
  $('#chat-form').hidden = kind !== 'chat';
  kind === 'chat' ? renderChat() : renderPeople();
}

function bindUI() {
  $('#b-mic').onclick = () => { S.mic = !S.mic; applyTracks(); pushState(); };
  $('#b-cam').onclick = () => { S.cam = !S.cam; applyTracks(); pushState(); };
  $('#b-share').onclick = toggleShare;
  $('#b-rec').onclick = toggleRecord;
  $('#b-hand').onclick = () => { S.hand = !S.hand; pushState(); syncButtons(); if (S.hand) wsend({ t: 'react', e: '✋' }); };
  $('#b-draw').onclick = () => setDraw(!S.drawing);
  $('#b-wb').onclick = () => {
    S.wbOpen = !S.wbOpen; $('#whiteboard').hidden = !S.wbOpen;
    if (S.wbOpen) { S.wb.resize(); setDraw(true); } else setDraw(false);
  };
  $('#b-chat').onclick = () => panel('chat', 'Chat');
  $('#b-people').onclick = () => panel('people', 'Participants');
  $('#b-host').onclick = () => panel('people', 'Host controls');
  $('#b-leave').onclick = () => {
    if (S.rec) { S.rec.stop(); toast('Saving recording…'); setTimeout(leaveNow, 900); }
    else leaveNow();
  };
  $('#panel-close').onclick = () => $('#panel').hidden = true;
  $('#focus-close').onclick = closeFocus;
  $('#chat-form').onsubmit = e => {
    e.preventDefault();
    const v = $('#chat-in').value.trim(); if (!v) return;
    wsend({ t: 'chat', text: v }); $('#chat-in').value = '';
  };
  document.querySelectorAll('#palette [data-tool]').forEach(b => b.onclick = () => {
    document.querySelectorAll('#palette [data-tool]').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); S.ink.tool = S.wb.tool = b.dataset.tool;
  });
  $('#ink-color').oninput = e => { S.ink.color = S.wb.color = e.target.value; };
  $('#ink-width').oninput = e => { S.ink.width = S.wb.width = +e.target.value; };
  $('#ink-undo').onclick = () => (S.wbOpen ? S.wb : S.ink).undo(S.self.id);
  $('#ink-clear').onclick = () => (S.wbOpen ? S.wb : S.ink).clear();
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'm') $('#b-mic').click();
    if (e.key === 'v') $('#b-cam').click();
    if (e.key === 'd') $('#b-draw').click();
  });
  startVAD();
  addEventListener('beforeunload', () => { try { S.ws.close(); } catch {} });
}

/* --------- local voice activity: 1 tiny WS message, no server CPU -------- */
function startVAD() {
  const a = S.local.getAudioTracks()[0]; if (!a) return;
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(new MediaStream([a]));
  const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
  const buf = new Uint8Array(an.frequencyBinCount);
  let last = false;
  S.vadTimer = setInterval(() => {
    an.getByteFrequencyData(buf);
    const avg = buf.reduce((x, y) => x + y, 0) / buf.length;
    const speaking = S.mic && avg > 22;
    if (speaking !== last) { last = speaking; S.speaking = speaking; pushState(); }
  }, 500);
}

/* ------------------------------- helpers -------------------------------- */
function toast(msg, ms = 4000, actions) {
  const t = el('div', 'toast', msg);
  if (actions) actions.forEach(([label, fn]) => {
    const b = el('button', 'mini', label); b.onclick = () => { fn(); t.remove(); }; t.append(b);
  });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
  return t;
}

const hud = txt => $('#hud').textContent = txt;

function flyReaction(id, e) {
  const p = id === S.self.id ? null : S.peers.get(id);
  const n = el('div', 'reaction', e);
  (p && p.tile ? p.tile : document.body).append(n);
  setTimeout(() => n.remove(), 2500);
}

/* ===================== client-side recording (local) ==================== */
function leaveNow() {
  if (S.vadTimer) clearInterval(S.vadTimer);
  try { S.ws.close(); S.mesh.destroy(); } catch {}
  location.href = '/';
}

function toggleRecord() {
  if (S.rec) { S.rec.stop(); return; }
  S.rec = new Recorder({
    filename: `PicoMeet-${S.room.code}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`,
    getLayout: recLayout,
    getAudioTracks: recAudioTracks,
    onTick: sec => {
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      $('#b-rec').querySelector('span').textContent = `${mm}:${String(sec % 60).padStart(2, '0')}`;
    },
    onStop: bytes => {
      S.rec = null;
      $('#b-rec').classList.remove('on', 'recing');
      $('#b-rec').querySelector('span').textContent = 'Rec';
      toast(`Recording saved to your Downloads (${(bytes / 1048576).toFixed(1)} MB).`, 8000);
      wsend({ t: 'chat', text: '⏹ Recording stopped.' });
    }
  });
  try { S.rec.start(); } catch (e) {
    S.rec = null;
    return toast('Recording is not supported in this browser.');
  }
  $('#b-rec').classList.add('on', 'recing');
  toast('Recording started — the file saves to YOUR device, not the server.', 6000);
  wsend({ t: 'chat', text: `⏺ ${S.self.name} started recording this meeting (saved locally).` });
}

function recLayout() {
  if (!$('#focus').hidden) {
    return [{ video: $('#focus-video'), label: $('#focus-label').textContent, mirror: false }];
  }
  const cells = [];
  document.querySelectorAll('#grid .tile').forEach(t => {
    const id = t.dataset.id;
    const self = id === S.self.id;
    const name = self ? S.self.name : ((S.peers.get(id) || {}).name || '');
    const hasVideo = !t.classList.contains('novideo');
    cells.push({ video: hasVideo ? t.querySelector('video') : null, label: name, mirror: self && !S.sharing });
  });
  return cells;
}

function recAudioTracks() {
  const out = [...S.local.getAudioTracks()];
  if (S.mesh) for (const p of S.mesh.peers.values()) out.push(...p.stream.getAudioTracks());
  return out;
}
