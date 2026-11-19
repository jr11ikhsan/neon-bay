// NEON BAY v3 — procedural WebAudio: engine hum, distance siren, gunshots, punches, cash,
// mission jingles and a slow neon pad. No audio assets; everything is synthesized.
export class AudioEngine {
  constructor() {
    this.ctx = null; this.muted = false; this.padT = 0; this.chord = 0;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(ctx.destination);
    // Engine: sawtooth through a lowpass, pitch follows speed.
    this.engOsc = ctx.createOscillator(); this.engOsc.type = 'sawtooth'; this.engOsc.frequency.value = 55;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 300;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engOsc.connect(this.engFilter).connect(this.engGain).connect(this.master); this.engOsc.start();
    // Siren: triangle LFO between two tones, gain follows nearest police distance.
    this.sirOsc = ctx.createOscillator(); this.sirOsc.type = 'triangle'; this.sirOsc.frequency.value = 700;
    this.sirGain = ctx.createGain(); this.sirGain.gain.value = 0;
    this.sirOsc.connect(this.sirGain).connect(this.master); this.sirOsc.start();
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.5; }
  noise(dur, freq, gain, type = 'bandpass') {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master); src.start();
  }
  blip(freq, dur, gain, type = 'square', slide = 0) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ctx.currentTime + dur);
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(this.master); o.start(); o.stop(ctx.currentTime + dur);
  }
  handle(ev) {
    if (!this.ctx) return;
    switch (ev.k) {
      case 'shot': if (ev.weapon === 'cop' || ev.weapon === 'dealer') this.noise(0.09, 900, 0.10); else if (ev.weapon === 'shotgun') this.noise(0.22, 500, 0.30); else if (ev.weapon === 'smg') this.noise(0.06, 1300, 0.16); else this.noise(0.12, 1100, 0.22); break;
      case 'punch': this.noise(0.07, 240, 0.25, 'lowpass'); break;
      case 'cash': this.blip(1320, 0.09, 0.16); setTimeout(() => this.blip(1760, 0.12, 0.16), 55); break;
      case 'jingle': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 0.14, 'triangle'), i * 95)); break;
      case 'crash': this.noise(0.25, 300, 0.28, 'lowpass'); break;
      case 'down': this.blip(160, 0.25, 0.2, 'sawtooth', -90); break;
      case 'enter': this.blip(320, 0.07, 0.10, 'triangle'); break;
      case 'busted': case 'wasted': [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.blip(f, 0.3, 0.15, 'triangle'), i * 130)); break;
      case 'save': this.blip(880, 0.1, 0.1, 'triangle'); break;
    }
  }
  // Called every frame: engine + siren follow the world; a slow pad chord drifts underneath.
  update(dt, world) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, p = world.player;
    const spd = p.car ? Math.abs(p.car.spd) : 0;
    this.engGain.gain.value = p.car ? 0.05 + Math.min(0.10, spd / 5200) : 0;
    this.engOsc.frequency.value = 50 + spd * 0.16;
    this.engFilter.frequency.value = 240 + spd * 0.9;
    let nd = 1e9;
    for (const c of world.cars) if (c.kind === 'police') nd = Math.min(nd, Math.hypot(c.x - p.x, c.y - p.y));
    this.sirGain.gain.value = nd < 900 ? 0.028 * (1 - nd / 900) : 0;
    this.sirOsc.frequency.value = 660 + Math.sin(ctx.currentTime * 5.2) * 130;
    this.padT -= dt;
    if (this.padT <= 0) {
      this.padT = 3.6;
      const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 196, 246.9]];
      for (const f of chords[this.chord++ % chords.length]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, ctx.currentTime);
        g.gain.linearRampToValueAtTime(0.016, ctx.currentTime + 1.1);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + 3.6);
        o.connect(g).connect(this.master); o.start(); o.stop(ctx.currentTime + 3.7);
      }
    }
  }
}
