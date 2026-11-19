// Procedural WebAudio sound for NEON BAY: no audio files, everything is oscillators
// and filtered noise started after the first user gesture. Engine hum and police
// sirens are continuous voices the world turns up and down; the rest are one-shots.
// A tiny pad loop plays a slow tropical chord progression under everything.

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenLfo = null;
  let musicTimer = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      startMusic();
      return true;
    } catch {
      return false;
    }
  }

  function tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, delay = 0) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol = 0.2, freq = 1200, delay = 0) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(master);
    src.start(t0);
  }

  function startMusic() {
    // Slow pad: Am — F — C — G, one chord every 4.4 s, very quiet.
    const chords = [
      [110.0, 164.81, 261.63], [87.31, 174.61, 220.0], [130.81, 196.0, 261.63], [98.0, 196.0, 246.94],
    ];
    let step = 0;
    const playChord = () => {
      if (!ctx) return;
      const chord = chords[step % chords.length];
      step += 1;
      for (const f of chord) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.028, ctx.currentTime + 1.2);
        gain.gain.linearRampToValueAtTime(0.0, ctx.currentTime + 4.4);
        osc.connect(gain).connect(master);
        osc.start();
        osc.stop(ctx.currentTime + 4.5);
      }
      musicTimer = window.setTimeout(playChord, 4400);
    };
    playChord();
  }

  return {
    unlock() { ensure(); },
    toggleMute() {
      muted = !muted;
      if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.03);
      return muted;
    },
    isMuted() { return muted; },
    shot() { noise(0.09, 0.25, 900); tone(160, 0.08, 'square', 0.12, 60); },
    punch() { noise(0.07, 0.2, 400); tone(90, 0.07, 'sine', 0.2, 50); },
    hurt() { tone(220, 0.12, 'sawtooth', 0.1, 110); },
    cash() { tone(880, 0.07, 'sine', 0.15); tone(1320, 0.1, 'sine', 0.15, null, 0.06); },
    pickup() { tone(660, 0.08, 'sine', 0.14); tone(990, 0.1, 'sine', 0.14, null, 0.07); },
    enterCar() { tone(196, 0.09, 'sine', 0.12); tone(147, 0.12, 'sine', 0.1, null, 0.07); },
    crash(intensity = 1) { noise(0.18, 0.22 * intensity, 300); tone(70, 0.16, 'sine', 0.2 * intensity, 40); },
    mission() {
      tone(523, 0.12, 'triangle', 0.16); tone(659, 0.12, 'triangle', 0.16, null, 0.11);
      tone(784, 0.2, 'triangle', 0.18, null, 0.22);
    },
    failed() { tone(392, 0.14, 'triangle', 0.15); tone(311, 0.22, 'triangle', 0.15, null, 0.13); },
    busted() { tone(440, 0.16, 'square', 0.1); tone(440, 0.16, 'square', 0.1, null, 0.22); tone(349, 0.3, 'square', 0.1, null, 0.44); },
    /** Continuous voices: engine pitch follows speed 0..1, siren level 0..1. */
    setEngine(on, speedRatio) {
      if (!ensure()) return;
      if (on && !engineOsc) {
        engineOsc = ctx.createOscillator();
        engineGain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        engineOsc.type = 'sawtooth';
        engineGain.gain.value = 0.0;
        engineOsc.connect(filter).connect(engineGain).connect(master);
        engineOsc.start();
      }
      if (engineOsc) {
        const target = on ? 0.05 + speedRatio * 0.05 : 0;
        engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.09);
        engineOsc.frequency.setTargetAtTime(55 + speedRatio * 165, ctx.currentTime, 0.09);
      }
    },
    setSiren(level) {
      if (!ensure()) return;
      if (level > 0 && !sirenOsc) {
        sirenOsc = ctx.createOscillator();
        sirenGain = ctx.createGain();
        sirenLfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        sirenOsc.type = 'triangle';
        sirenOsc.frequency.value = 1050;
        sirenLfo.frequency.value = 0.65;
        lfoGain.gain.value = 330;
        sirenLfo.connect(lfoGain).connect(sirenOsc.frequency);
        sirenGain.gain.value = 0;
        sirenOsc.connect(sirenGain).connect(master);
        sirenOsc.start();
        sirenLfo.start();
      }
      if (sirenOsc) sirenGain.gain.setTargetAtTime(level * 0.035, ctx.currentTime, 0.2);
    },
  };
}
