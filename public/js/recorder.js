/* PicoMeet client-side recorder — ZERO server cost.
 *
 * How it works:
 *   1. A hidden <canvas> composites every visible video tile (or the
 *      spotlight/screen-share when focus mode is active) at 12 fps.
 *   2. Web Audio mixes the local mic + every remote audio track into one
 *      destination stream. New participants are picked up automatically
 *      every 2 seconds.
 *   3. canvas.captureStream() + mixed audio → MediaRecorder → chunks in
 *      memory → a .webm (or .mp4 on Safari) file downloaded locally.
 *
 * The server never sees a byte of the recording. */
export class Recorder {
  constructor(opts) {
    // opts: { getLayout(): [{video, label, mirror}], getAudioTracks(): MediaStreamTrack[],
    //         filename: string, onTick(sec), onStop() }
    this.o = opts;
    this.recording = false;
  }
  static supported() {
    return typeof MediaRecorder !== 'undefined' &&
           !!document.createElement('canvas').captureStream;
  }
  start() {
    const W = 1280, H = 720, FPS = 12;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    /* ---------- audio mixing ---------- */
    this.ac = new (window.AudioContext || window.webkitAudioContext)();
    this.dest = this.ac.createMediaStreamDestination();
    this.attached = new Set();
    this._mixAudio();
    this.audioTimer = setInterval(() => this._mixAudio(), 2000);
    /* ---------- video composite ---------- */
    this.drawTimer = setInterval(() => this._draw(), Math.round(1000 / FPS));
    const stream = this.canvas.captureStream(FPS);
    this.dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    /* ---------- encoder ---------- */
    const mime = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'                       // Safari fallback
    ].find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '';
    this.ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    this.chunks = [];
    this.rec = new MediaRecorder(stream, {
      mimeType: mime || undefined,
      videoBitsPerSecond: 1200000,      // ~9 MB per minute — safe for RAM
      audioBitsPerSecond: 96000
    });
    this.rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.onstop = () => this._finish();
    this.rec.start(1000);               // flush a chunk every second
    this.startedAt = Date.now();
    this.recording = true;
  }
  stop() {
    if (!this.recording) return;
    this.recording = false;
    clearInterval(this.drawTimer);
    clearInterval(this.audioTimer);
    try { if (this.rec.state !== 'inactive') this.rec.stop(); } catch { this._finish(); }
  }
  /* Attach any audio track we have not mixed in yet (late joiners included). */
  _mixAudio() {
    for (const tr of this.o.getAudioTracks()) {
      if (!tr || this.attached.has(tr.id) || tr.readyState !== 'live') continue;
      try {
        this.ac.createMediaStreamSource(new MediaStream([tr])).connect(this.dest);
        this.attached.add(tr.id);
      } catch { /* track not ready yet — retried in 2 s */ }
    }
  }
  _draw() {
    const { ctx, canvas } = this;
    const cells = this.o.getLayout();
    ctx.fillStyle = '#0e1116';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const n = Math.max(cells.length, 1);
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const cw = canvas.width / cols, ch = canvas.height / rows;
    ctx.font = '14px system-ui, sans-serif';
    cells.forEach((c, i) => {
      const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
      const v = c.video;
      if (v && v.readyState >= 2 && v.videoWidth) {
        const s = Math.max(cw / v.videoWidth, ch / v.videoHeight);   // cover-fit
        const dw = v.videoWidth * s, dh = v.videoHeight * s;
        ctx.save();
        ctx.beginPath(); ctx.rect(x + 1, y + 1, cw - 2, ch - 2); ctx.clip();
        if (c.mirror) {                                              // self preview
          ctx.translate(x + cw, 0); ctx.scale(-1, 1);
          ctx.drawImage(v, (cw - dw) / 2, y + (ch - dh) / 2, dw, dh);
        } else {
          ctx.drawImage(v, x + (cw - dw) / 2, y + (ch - dh) / 2, dw, dh);
        }
        ctx.restore();
      } else {
        ctx.fillStyle = '#1b222c'; ctx.fillRect(x + 2, y + 2, cw - 4, ch - 4);
        ctx.fillStyle = '#8b949e'; ctx.textAlign = 'center';
        ctx.fillText(c.label || '', x + cw / 2, y + ch / 2);
        ctx.textAlign = 'left';
      }
      if (c.label && v) {
        const w = ctx.measureText(c.label).width;
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(x + 8, y + ch - 32, w + 16, 22);
        ctx.fillStyle = '#fff';
        ctx.fillText(c.label, x + 16, y + ch - 16);
      }
    });
    /* REC badge + elapsed timer, burned into the recording */
    const sec = Math.floor((Date.now() - this.startedAt) / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(10, 10, 96, 26);
    ctx.fillStyle = '#f85149'; ctx.beginPath(); ctx.arc(24, 23, 6, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(`${mm}:${ss}`, 38, 28);
    this.o.onTick && this.o.onTick(sec);
  }
  _finish() {
    try { this.ac.close(); } catch {}
    const blob = new Blob(this.chunks, { type: this.chunks[0] ? this.chunks[0].type : 'video/webm' });
    this.chunks = [];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.o.filename || 'PicoMeet-recording'}.${this.ext}`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    this.o.onStop && this.o.onStop(blob.size);
  }
}
