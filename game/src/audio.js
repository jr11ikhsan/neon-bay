// NEON BAY — procedural WebAudio. No samples, no files: engine hum, sirens,
// gunshots, cash and a slow synth pad are all synthesised on the fly.
// Everything is guarded so the game runs silent until the first user
// gesture creates the context (and stays silent in headless tests).

export class AudioSys {
  constructor() {
    this.ctx = null; this.muted = false;
    this.engineOsc = null; this.engineGain = null; this.engineFilter = null;
    this.sirenOsc = null; this.sirenGain = null;
    this.padTimer = 0; this.padStep = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // Engine: detuned saws through a lowpass, gain follows being in a car.
      this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0;
      this.engineFilter = this.ctx.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 400;
      this.engineOsc = this.ctx.createOscillator(); this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 60;
      const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 30;
      const g2 = this.ctx.createGain(); g2.gain.value = 0.4;
      this.engineOsc.connect(this.engineFilter); o2.connect(g2); g2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain); this.engineGain.connect(this.master);
      this.engineOsc.start(); o2.start();
      // Siren: a triangle whose pitch wobbles, gain follows the nearest unit.
      this.sirenGain = this.ctx.createGain(); this.sirenGain.gain.value = 0;
      this.sirenOsc = this.ctx.createOscillator(); this.sirenOsc.type = 'triangle'; this.sirenOsc.frequency.value = 900;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.55;
      const lfoG = this.ctx.createGain(); lfoG.gain.value = 260;
      lfo.connect(lfoG); lfoG.connect(this.sirenOsc.frequency); lfo.start();
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
      this.sirenOsc.start();
    } catch { this.ctx = null; }
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.5; }

  setEngine(norm, inCar) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(inCar ? 0.05 + norm * 0.1 : 0, t, 0.09);
    this.engineOsc.frequency.setTargetAtTime(55 + norm * 165, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(300 + norm * 900, t, 0.1);
  }
  setSiren(prox) {
    if (!this.ctx) return;
    this.sirenGain.gain.setTargetAtTime(clamp01(prox) * 0.055, this.ctx.currentTime, 0.15);
  }

  blip(freq, dur, type = 'sine', vol = 0.2, slide = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, vol, freq = 1800) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, (this.ctx.sampleRate * dur) | 0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
  }

  shot() { this.noise(0.13, 0.5, 2600); this.blip(160, 0.09, 'square', 0.16, -90); }
  punch() { this.blip(95, 0.12, 'sine', 0.35, -40); }
  crash() { this.noise(0.25, 0.4, 700); }
  door() { this.blip(220, 0.07, 'sine', 0.12, -60); }
  cash() { this.blip(880, 0.09, 'sine', 0.18); setTimeout(() => this.blip(1320, 0.14, 'sine', 0.18), 55); }
  pickup() { this.blip(660, 0.08, 'sine', 0.16); setTimeout(() => this.blip(990, 0.1, 'sine', 0.16), 50); }
  mission() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 'triangle', 0.2), i * 95)); }
  busted() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.blip(f, 0.25, 'sawtooth', 0.12), i * 120)); }
  wasted() { this.blip(220, 0.7, 'sawtooth', 0.14, -140); }

  // Slow neon pad: a four-chord loop, one chord every four seconds.
  updatePad(dt) {
    if (!this.ctx || this.muted) return;
    this.padTimer -= dt;
    if (this.padTimer > 0) return;
    this.padTimer = 4;
    const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 196, 261.6]];
    const chord = chords[this.padStep++ % chords.length];
    for (const f of chord) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      const t = this.ctx.currentTime;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.028, t + 1.1);
      g.gain.linearRampToValueAtTime(0, t + 4.05);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 4.1);
    }
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
