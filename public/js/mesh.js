/* PicoMeet mesh engine — one RTCPeerConnection per remote peer.
   Implements W3C Perfect Negotiation to eliminate SDP glare. */
export class Mesh extends EventTarget {
  constructor({ selfId, send, ice }) {
    super();
    this.selfId = selfId;
    this.send = send;                 // (to, data) => void via WebSocket
    this.ice = ice;
    this.peers = new Map();           // id -> {pc, dc, polite, making, ignore, stream}
    this.local = null;                // Base MediaStream (microphone/camera)
    this.activeVideoTrack = null;     // Tracks active webcam or screen track
    this.quality = { kbps: 450, fps: 20, w: 640, h: 360 };
  }

  setIce(ice) { this.ice = ice; }

  /* ---------------------------------------------------------------- peers */
  ensure(id) {
    if (this.peers.has(id)) return this.peers.get(id);
    const pc = new RTCPeerConnection({
      iceServers: this.ice,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 0
    });

    const p = {
      id, pc, dc: null,
      polite: this.selfId < id,       // Deterministic & symmetric
      making: false, ignore: false,
      stream: new MediaStream()
    };
    this.peers.set(id, p);

    // Reliable ordered data channel for ink, controls, whiteboard
    if (!p.polite) {
      p.dc = pc.createDataChannel('pm', { ordered: true });
      this._wireDC(p);
    }
    pc.ondatachannel = e => { p.dc = e.channel; this._wireDC(p); };

    pc.onicecandidate = e => {
      if (e.candidate) this.send(id, { candidate: e.candidate });
    };

    pc.onnegotiationneeded = async () => {
      try {
        p.making = true;
        await pc.setLocalDescription();
        this.send(id, { desc: pc.localDescription });
      } catch (err) {
        console.warn('negotiation', err);
      } finally {
        p.making = false;
      }
    };

    pc.ontrack = e => {
      e.track.onended = () => this._emitStream(p);
      if (!p.stream.getTracks().includes(e.track)) p.stream.addTrack(e.track);
      this._emitStream(p);
    };

    pc.onconnectionstatechange = () => {
      this.dispatchEvent(new CustomEvent('conn', { detail: { id, state: pc.connectionState } }));
      if (pc.connectionState === 'failed') {
        try { pc.restartIce(); } catch {}
      }
    };

    // Attach local audio tracks
    if (this.local) {
      for (const t of this.local.getAudioTracks()) pc.addTrack(t, this.local);
    }

    // Attach active video track (webcam or screen-share)
    const vTrack = this.activeVideoTrack || (this.local && this.local.getVideoTracks()[0]);
    if (vTrack) {
      pc.addTrack(vTrack, this.local || new MediaStream([vTrack]));
    }

    this.applyQuality(p);
    return p;
  }

  _emitStream(p) {
    this.dispatchEvent(new CustomEvent('stream', { detail: { id: p.id, stream: p.stream } }));
  }

  _wireDC(p) {
    p.dc.binaryType = 'arraybuffer';
    p.dc.onopen = () => this.dispatchEvent(new CustomEvent('dcopen', { detail: { id: p.id, dc: p.dc } }));
    p.dc.onmessage = e => this.dispatchEvent(new CustomEvent('dcmsg', { detail: { id: p.id, data: e.data } }));
  }

  /* ------------------------------------------------------------ signalling */
  async onSignal(from, data) {
    const p = this.ensure(from);
    const pc = p.pc;
    try {
      if (data.desc) {
        const offerCollision = data.desc.type === 'offer' &&
          (p.making || pc.signalingState !== 'stable');
        p.ignore = !p.polite && offerCollision;
        if (p.ignore) return;
        await pc.setRemoteDescription(data.desc);
        if (data.desc.type === 'offer') {
          await pc.setLocalDescription();
          this.send(from, { desc: pc.localDescription });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          if (!p.ignore) throw err;
        }
      }
    } catch (err) {
      console.warn('signal', err);
    }
  }

  /* --------------------------------------------------------------- media */
  async publish(stream) {
    this.local = stream;
    this.activeVideoTrack = stream.getVideoTracks()[0] || null;
    for (const p of this.peers.values()) {
      for (const track of stream.getTracks()) {
        const sender = p.pc.getSenders().find(s => s.track && s.track.kind === track.kind);
        if (sender) await sender.replaceTrack(track);
        else p.pc.addTrack(track, stream);
      }
      this.applyQuality(p);
    }
  }

  /** Swap video track across all peers without renegotiation **/
  async replaceVideo(track) {
    this.activeVideoTrack = track;
    for (const p of this.peers.values()) {
      const s = p.pc.getSenders().find(x => x.track && x.track.kind === 'video')
             || p.pc.getSenders().find(x => !x.track);
      if (s) {
        await s.replaceTrack(track);
      } else if (track) {
        p.pc.addTrack(track, this.local || new MediaStream([track]));
      }
      this.applyQuality(p);
    }
  }

  /** Enforce quality contract on video/audio encoders **/
  setQuality(q) {
    this.quality = { ...this.quality, ...q };
    this.peers.forEach(p => this.applyQuality(p));
  }

  async applyQuality(p) {
    for (const s of p.pc.getSenders()) {
      if (!s.track) continue;
      const params = s.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      if (s.track.kind === 'video') {
        params.encodings[0].maxBitrate = this.quality.kbps * 1000;
        params.encodings[0].maxFramerate = this.quality.fps;
        params.degradationPreference = this.quality.screen ? 'maintain-resolution' : 'balanced';
      } else {
        params.encodings[0].maxBitrate = (this.quality.audioKbps || 32) * 1000;
      }
      try { await s.setParameters(params); } catch {}
    }
  }

  broadcastDC(obj) {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    for (const p of this.peers.values()) {
      if (p.dc && p.dc.readyState === 'open' && p.dc.bufferedAmount < 4 * 1024 * 1024) {
        try { p.dc.send(s); } catch {}
      }
    }
  }

  close(id) {
    const p = this.peers.get(id);
    if (!p) return;
    try { p.dc && p.dc.close(); } catch {}
    try { p.pc.close(); } catch {}
    this.peers.delete(id);
  }

  destroy() {
    [...this.peers.keys()].forEach(id => this.close(id));
  }

  async stats() {
    const out = [];
    for (const p of this.peers.values()) {
      const r = await p.pc.getStats();
      let o = null, rtt = null;
      r.forEach(s => {
        if (s.type === 'outbound-rtp' && s.kind === 'video') o = s;
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.currentRoundTripTime != null) {
          rtt = s.currentRoundTripTime;
        }
      });
      out.push({ id: p.id, limited: o && o.qualityLimitationReason, rtt, state: p.pc.connectionState });
    }
    return out;
  }
}
