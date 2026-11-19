// NEON BAY v5 — procedural WebAudio: no samples, everything synthesized.
// Engine hum tied to speed, a two-tone siren that swells as the law gets
// close, noise-burst gunfire, coin chimes, mission jingles and a slow
// synthwave pad under it all. In a headless world (no AudioContext) every
// method is a safe no-op.

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let engineOsc = null; let engineGain = null;
  let sirenOsc = null; let sirenGain = null;
  let padTimer = 0; let padStep = 0;

  function unlock() {
    if (ctx || typeof window === 'undefined' || !window.AudioContext) return;
    try {
      ctx = new window.AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      // engine: a low saw through a lowpass, always running, gain-led
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 50;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter).connect(engineGain).connect(master);
      engineOsc.start();
      // siren: triangle alternating two tones in tick()
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 700;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain).connect(master);
      sirenOsc.start();
    } catch { ctx = null; }
  }

  function tone(freq, dur, type = 'sine', vol = 0.16, when = 0, slideTo = null) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur = 0.11, vol = 0.22) {
    if (!ctx || muted) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 700;
    src.connect(filter).connect(gain).connect(master);
    src.start();
  }

  const CHORDS = [
    [110.0, 164.8, 261.6], [87.3, 174.6, 220.0], [98.0, 196.0, 246.9], [130.8, 196.0, 329.6],
  ];

  return {
    unlock,
    get muted() { return muted; },
    toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; return muted; },
    shot() { noiseBurst(0.1, 0.2); },
    hit() { tone(180, 0.08, 'square', 0.1); },
    punch() { tone(120, 0.09, 'sine', 0.2, 0, 60); },
    money() { tone(1318, 0.09, 'sine', 0.14); tone(1760, 0.14, 'sine', 0.12, 0.07); },
    pickup() { tone(880, 0.1, 'sine', 0.12, 0, 1320); },
    mission() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, 'triangle', 0.13, i * 0.09)); },
    busted() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.2, 'square', 0.09, i * 0.13)); },
    wasted() { tone(220, 0.7, 'sawtooth', 0.1, 0, 55); },
    enter() { tone(140, 0.12, 'sine', 0.18, 0, 80); },
    setEngine(speedRatio, inCar) {
      if (!ctx) return;
      const target = inCar && !muted ? 0.05 + Math.abs(speedRatio) * 0.05 : 0;
      engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
      engineOsc.frequency.setTargetAtTime(48 + Math.abs(speedRatio) * 130, ctx.currentTime, 0.08);
    },
    setSiren(level) {
      if (!ctx) return;
      sirenGain.gain.setTargetAtTime(muted ? 0 : level * 0.06, ctx.currentTime, 0.1);
    },
    /** Advance the siren alternation and the pad progression. */
    tick(dt) {
      if (!ctx) return;
      if (sirenOsc) sirenOsc.frequency.value = Math.floor(ctx.currentTime * 1.6) % 2 === 0 ? 660 : 880;
      padTimer -= dt;
      if (padTimer <= 0) {
        padTimer = 4.2;
        const chord = CHORDS[padStep % CHORDS.length];
        padStep += 1;
        if (!muted) for (const f of chord) tone(f, 4.4, 'triangle', 0.028);
      }
    },
  };
}
