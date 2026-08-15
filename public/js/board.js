/* Ink travels over WebRTC data channels only — zero server overhead.
   Coordinates are normalized 0..1 relative to the rendered video content box
   so every screen aspect ratio and resolution renders identically. */
export class Board {
  constructor(canvas, { onStroke }) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.onStroke = onStroke;
    this.strokes = [];        // Full stroke history
    this.cur = null;
    this.tool = 'pen';        // pen | marker | arrow | rect | eraser
    this.color = '#ff3b30';
    this.width = 3;
    this.enabled = false;
    this._bind();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const r = this.c.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.c.width = Math.max(1, r.width * dpr);
    this.c.height = Math.max(1, r.height * dpr);
    this.c.style.width = r.width + 'px';
    this.c.style.height = r.height + 'px';
    this.redraw();
  }

  /* Compute active video boundary inside object-fit: contain */
  _getBounds() {
    const r = this.c.getBoundingClientRect();
    const video = this.c.parentElement.querySelector('video');

    if (!video || !video.videoWidth || !video.videoHeight) {
      return { x: 0, y: 0, w: r.width, h: r.height };
    }

    const videoRatio = video.videoWidth / video.videoHeight;
    const containerRatio = r.width / r.height;
    let w = r.width, h = r.height, x = 0, y = 0;

    if (containerRatio > videoRatio) {
      w = r.height * videoRatio;
      x = (r.width - w) / 2;
    } else {
      h = r.width / videoRatio;
      y = (r.height - h) / 2;
    }

    return { x, y, w, h };
  }

  _pt(e) {
    const r = this.c.getBoundingClientRect();
    const b = this._getBounds();
    const clientX = e.clientX - r.left - b.x;
    const clientY = e.clientY - r.top - b.y;

    return {
      x: Math.max(0, Math.min(1, clientX / b.w)),
      y: Math.max(0, Math.min(1, clientY / b.h))
    };
  }

  _bind() {
    const down = e => {
      if (!this.enabled) return;
      this.c.setPointerCapture(e.pointerId);
      this.cur = {
        id: Math.random().toString(36).slice(2, 9),
        tool: this.tool,
        color: this.color,
        width: this.width,
        pts: [this._pt(e)]
      };
    };

    const move = e => {
      if (!this.cur) return;
      const p = this._pt(e);
      const last = this.cur.pts[this.cur.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.0025) return; // Point thinning
      this.cur.pts.push(p);
      this.redraw(this.cur);
      if (this.cur.pts.length % 4 === 0) {
        this.onStroke({ k: 'ink', partial: true, s: this.cur });
      }
    };

    const up = () => {
      if (!this.cur) return;
      this.strokes.push(this.cur);
      this.onStroke({ k: 'ink', s: this.cur });
      this.cur = null;
      this.redraw();
    };

    this.c.addEventListener('pointerdown', down);
    this.c.addEventListener('pointermove', move);
    this.c.addEventListener('pointerup', up);
    this.c.addEventListener('pointercancel', up);
  }

  remote(msg) {
    if (msg.k === 'ink') {
      const i = this.strokes.findIndex(s => s.id === msg.s.id);
      if (i >= 0) this.strokes[i] = msg.s;
      else this.strokes.push(msg.s);
      if (this.strokes.length > 4000) this.strokes.splice(0, 500);
      this.redraw();
    } else if (msg.k === 'clear') {
      this.strokes = [];
      this.redraw();
    } else if (msg.k === 'undo') {
      for (let i = this.strokes.length - 1; i >= 0; i--) {
        if (this.strokes[i].by === msg.by) {
          this.strokes.splice(i, 1);
          break;
        }
      }
      this.redraw();
    } else if (msg.k === 'sync') {
      this.strokes = msg.strokes || [];
      this.redraw();
    }
  }

  clear(local = true) {
    this.strokes = [];
    this.redraw();
    if (local) this.onStroke({ k: 'clear' });
  }

  undo(by) {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (this.strokes[i].by === by) {
        this.strokes.splice(i, 1);
        break;
      }
    }
    this.redraw();
    this.onStroke({ k: 'undo', by });
  }

  snapshot() {
    return { k: 'sync', strokes: this.strokes.slice(-1500) };
  }

  redraw(extra) {
    const { ctx, c } = this;
    ctx.clearRect(0, 0, c.width, c.height);
    const b = this._getBounds();
    const dpr = c.width / (parseFloat(c.style.width) || c.width);

    // Canvas scaling to match DPI
    const renderBox = {
      x: b.x * dpr,
      y: b.y * dpr,
      w: b.w * dpr,
      h: b.h * dpr
    };

    for (const s of this.strokes) this._draw(s, renderBox);
    if (extra) this._draw(extra, renderBox);
  }

  _draw(s, box) {
    const { ctx } = this;
    const X = p => box.x + p.x * box.w;
    const Y = p => box.y + p.y * box.h;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = s.tool === 'marker' ? 0.35 : 1;
    ctx.lineWidth = (s.tool === 'marker' ? s.width * 4 : s.width) * (box.w / 1000);

    if (s.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth *= 6;
    }

    ctx.beginPath();
    if (s.tool === 'rect' && s.pts.length > 1) {
      const a = s.pts[0], b = s.pts[s.pts.length - 1];
      ctx.rect(X(a), Y(a), X(b) - X(a), Y(b) - Y(a));
    } else if (s.tool === 'arrow' && s.pts.length > 1) {
      const a = s.pts[0], b = s.pts[s.pts.length - 1];
      ctx.moveTo(X(a), Y(a));
      ctx.lineTo(X(b), Y(b));
      const ang = Math.atan2(Y(b) - Y(a), X(b) - X(a));
      const L = 14 * (box.w / 1000) * 2;
      ctx.moveTo(X(b), Y(b));
      ctx.lineTo(X(b) - L * Math.cos(ang - 0.4), Y(b) - L * Math.sin(ang - 0.4));
      ctx.moveTo(X(b), Y(b));
      ctx.lineTo(X(b) - L * Math.cos(ang + 0.4), Y(b) - L * Math.sin(ang + 0.4));
    } else {
      s.pts.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
