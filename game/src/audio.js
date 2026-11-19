// NEON BAY v2 — procedural WebAudio soundscape. No audio files: engine
// hum and sirens are continuous nodes, everything else is a synthesized
// one-shot (noise bursts for gunfire, sine drops for punches, little
// arpeggios for money and missions, a slow synthwave pad underneath).

export function createAudio() {
  let ctx = null, master = null, noiseBuf = null;
  let engine = null, siren = null, pad = null, muted = false;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch { return false; }
  }
  function env(g, t0, peak, dur) {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  }
  function tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, delay = 0) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    env(g, t0, vol, dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(dur, vol, freq, q = 1, type = 'bandpass', delay = 0) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); env(g, t0, vol, dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }
  function startLoops() {
    if (!ensure() || engine) return;
    const mk = (type, freq, vol) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = type; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = 420;
      g.gain.value = 0; o.connect(f); f.connect(g); g.connect(master); o.start();
      return { o, g, f };
    };
    engine = mk('sawtooth', 55, 0);
    siren = mk('square', 770, 0);
    siren.f.frequency.value = 3000;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.55; lg.gain.value = 120; lfo.connect(lg); lg.connect(siren.o.frequency); lfo.start();
    // slow pad: A minor -> F -> C -> G roots with fifths, gliding every 8 s
    pad = [110, 164.8, 220].map((fr) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = fr; g.gain.value = 0.016;
      o.connect(g); g.connect(master); o.start();
      return o;
    });
    const chords = [[110, 164.8, 261.6], [87.3, 174.6, 261.6], [98, 196, 293.7], [130.8, 196, 329.6]];
    let ci = 0;
    setInterval(() => {
      if (!ctx || muted) return;
      ci = (ci + 1) % chords.length;
      pad.forEach((o, i) => o.frequency.setTargetAtTime(chords[ci][i], ctx.currentTime, 1.6));
    }, 8000);
  }

  const sounds = {
    'shot-pistol': () => { noise(0.13, 0.5, 1500, 0.7); tone(210, 0.08, 'square', 0.1, 60); },
    'shot-smg': () => { noise(0.08, 0.36, 1900, 0.8); tone(240, 0.05, 'square', 0.07, 80); },
    'shot-shotgun': () => { noise(0.3, 0.7, 700, 0.5); tone(130, 0.2, 'square', 0.16, 40); },
    punch: () => tone(150, 0.09, 'sine', 0.3, 55),
    hit: () => { tone(320, 0.06, 'triangle', 0.22, 140); noise(0.05, 0.2, 900); },
    cash: () => { tone(880, 0.09, 'sine', 0.18); tone(1318, 0.14, 'sine', 0.18, null, 0.07); },
    step: () => { tone(660, 0.1, 'triangle', 0.16); tone(990, 0.12, 'triangle', 0.16, null, 0.08); },
    mission: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, 'triangle', 0.17, null, i * 0.09)); },
    error: () => tone(140, 0.16, 'square', 0.14, 110),
    click: () => tone(1200, 0.03, 'square', 0.06),
    door: () => { noise(0.09, 0.25, 300, 1, 'lowpass'); tone(85, 0.1, 'sine', 0.2, 50); },
    crash: () => { noise(0.28, 0.5, 240, 0.6, 'lowpass'); tone(70, 0.24, 'sine', 0.3, 34); },
    busted: () => { [392, 370, 349, 311].forEach((f, i) => tone(f, 0.22, 'sawtooth', 0.1, null, i * 0.13)); },
    wasted: () => tone(220, 1.1, 'sawtooth', 0.12, 55),
  };

  return {
    resume() { if (ensure()) { ctx.resume(); startLoops(); } },
    play(name) { if (sounds[name] && ensure()) sounds[name](); },
    setMuted(m) { muted = m; if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.03); },
    isMuted: () => muted,
    setEngine(on, ratio) {
      if (!engine || !ctx) return;
      engine.g.gain.setTargetAtTime(on && !muted ? 0.05 + ratio * 0.035 : 0, ctx.currentTime, 0.09);
      engine.o.frequency.setTargetAtTime(52 + ratio * 165, ctx.currentTime, 0.06);
    },
    setSiren(level) {
      if (!siren || !ctx) return;
      siren.g.gain.setTargetAtTime(!muted ? level * 0.045 : 0, ctx.currentTime, 0.12);
    },
  };
}
