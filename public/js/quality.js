/* Second line of defence: even inside the server's policy, a weak uplink
   steps itself down. Recovery is slow and hysteretic to avoid oscillation. */
const RUNGS = [
  { w: 1280, h: 720, fps: 30, kbps: 1400 },
  { w: 960,  h: 540, fps: 25, kbps: 800 },
  { w: 640,  h: 360, fps: 20, kbps: 450 },
  { w: 480,  h: 270, fps: 15, kbps: 280 },
  { w: 320,  h: 180, fps: 12, kbps: 160 },
  { w: 320,  h: 180, fps: 10, kbps: 100 }
];
export class QualityGovernor {
  constructor(mesh, onChange) {
    this.mesh = mesh; this.onChange = onChange;
    this.ceiling = 2; this.rung = 2; this.bad = 0; this.good = 0;
    this.timer = setInterval(() => this.tick(), 4000);
  }
  /** Server policy sets the ceiling; we may only go *down* from it. */
  setCeiling(policyVideo) {
    const i = RUNGS.findIndex(r => r.kbps <= policyVideo.kbps);
    this.ceiling = i < 0 ? RUNGS.length - 1 : i;
    if (this.rung < this.ceiling) this.rung = this.ceiling;
    this.apply();
  }
  async tick() {
    const s = await this.mesh.stats();
    const limited = s.filter(x => x.limited === 'bandwidth' || x.limited === 'cpu').length;
    const worstRtt = Math.max(0, ...s.map(x => x.rtt || 0));
    if (limited > 0 || worstRtt > 0.5) { this.bad++; this.good = 0; } else { this.good++; this.bad = 0; }
    if (this.bad >= 2 && this.rung < RUNGS.length - 1) { this.rung++; this.bad = 0; this.apply(); }
    if (this.good >= 8 && this.rung > this.ceiling) { this.rung--; this.good = 0; this.apply(); }
  }
  apply() { const r = RUNGS[this.rung]; this.mesh.setQuality(r); this.onChange && this.onChange(r); }
  destroy() { clearInterval(this.timer); }
}
