// Sound effects and ambience, all synthesized: no audio files to load.

const rnd = (a, b) => a + Math.random() * (b - a);
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Sfx {
  /** @param {import('./engine.js').AudioEngine} engine */
  constructor(engine) {
    this.engine = engine;
  }

  /** A sine "blip" with a pitch glide. */
  #tone({ f0, f1 = f0, dur, gain = 0.3, type = 'sine', when = 0, attack = 0.005, curve = 'exp' }) {
    const E = this.engine, c = E.ctx, t0 = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    else g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(g).connect(E.sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  #noise({ dur, freq, q = 1, gain = 0.3, type = 'bandpass', sweepTo = null, when = 0, attack = 0.003 }) {
    const E = this.engine, c = E.ctx, t0 = c.currentTime + when;
    const s = c.createBufferSource();
    s.buffer = E.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    s.connect(f).connect(g).connect(E.sfxBus);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + dur + 0.03);
  }

  /** Bell-like note: a few inharmonic partials with different decays. */
  #chime(freq, { when = 0, gain = 0.16, dur = 0.9 } = {}) {
    const partials = [[1, 1, 1], [2.76, 0.35, 0.55], [5.4, 0.16, 0.3]];
    for (const [mult, amp, life] of partials) {
      if (freq * mult > 12000) continue;
      this.#tone({ f0: freq * mult, dur: dur * life, gain: gain * amp, when, attack: 0.004 });
    }
  }

  /** Soft mallet note (marimba-ish). */
  #mallet(freq, { when = 0, gain = 0.22, dur = 0.4 } = {}) {
    this.#tone({ f0: freq, dur, gain, when, attack: 0.004 });
    this.#tone({ f0: freq * 4, dur: dur * 0.25, gain: gain * 0.18, when, attack: 0.002 });
  }

  play(name, opts = {}) {
    if (!this.engine.ready) return;
    const fn = this.#sounds[name];
    if (fn) fn(opts);
  }

  #sounds = {
    jump: () => this.#tone({ f0: 300, f1: 680, dur: 0.17, gain: 0.2, attack: 0.01, curve: 'lin' }),
    land: () => {
      this.#tone({ f0: 150, f1: 55, dur: 0.16, gain: 0.5 });
      this.#noise({ dur: 0.09, freq: 500, type: 'lowpass', gain: 0.22 });
    },
    step: () => {
      this.#tone({ f0: 170, f1: 80, dur: 0.1, gain: 0.3 });
      this.#noise({ dur: 0.05, freq: 700, type: 'lowpass', gain: 0.1 });
    },
    pop: () => {
      this.#tone({ f0: rnd(900, 1250), f1: 260, dur: 0.07, gain: 0.34 });
      this.#noise({ dur: 0.025, freq: 3000, q: 1, gain: 0.25 });
    },
    bubble: () => this.#tone({ f0: rnd(280, 380), f1: rnd(780, 980), dur: 0.09, gain: 0.2, attack: 0.02, curve: 'lin' }),
    clap: () => {
      this.#noise({ dur: 0.08, freq: 1700, q: 1.3, gain: 0.5 });
      this.#noise({ dur: 0.07, freq: 2300, q: 1.1, gain: 0.3, when: 0.012 });
    },
    whoosh: () => this.#noise({ dur: 0.55, freq: 500, sweepTo: 2600, q: 1.6, gain: 0.22, attack: 0.2 }),
    tap: () => this.#tone({ f0: 1300, f1: 700, dur: 0.035, gain: 0.14 }),
    sniff: () => this.#noise({ dur: 0.13, freq: 2600, type: 'highpass', gain: 0.07, attack: 0.05 }),
    chime: ({ note = 84 } = {}) => this.#chime(midi(note)),
    star: () => {
      this.#chime(midi(96), { gain: 0.12, dur: 0.8 });
      this.#chime(midi(103), { gain: 0.08, dur: 0.7, when: 0.07 });
    },
    sparkle: () => {
      const notes = [91, 96, 98, 103];
      notes.forEach((n, i) => this.#chime(midi(n), { when: i * 0.055, gain: 0.09, dur: 0.6 }));
    },
    heart: () => {
      this.#mallet(midi(81), { gain: 0.2 });
      this.#mallet(midi(88), { gain: 0.16, when: 0.09 });
    },
    success: () => {
      [84, 88, 91, 96].forEach((n, i) => this.#chime(midi(n), { when: i * 0.085, gain: 0.13, dur: 0.9 }));
    },
    bloom: () => {
      [72, 76, 79, 84, 88].forEach((n, i) => this.#mallet(midi(n), { when: i * 0.06, gain: 0.15, dur: 0.5 }));
    },
    magic: () => {
      for (let i = 0; i < 9; i++) this.#chime(midi(88 + Math.floor(Math.random() * 16)), { when: i * 0.07 + Math.random() * 0.03, gain: 0.05, dur: 0.6 });
    },
    count: ({ n = 1 } = {}) => this.#mallet(midi([72, 74, 76, 77, 79, 81, 83, 84, 86, 88][Math.min(9, n - 1)]), { gain: 0.24, dur: 0.5 }),
    rumble: () => {
      const E = this.engine, c = E.ctx, t0 = c.currentTime;
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(78, t0);
      o.frequency.linearRampToValueAtTime(62, t0 + 0.4);
      o.frequency.linearRampToValueAtTime(92, t0 + 0.8);
      const am = c.createOscillator();
      am.frequency.value = 17;
      const amG = c.createGain();
      amG.gain.value = 0.12;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.22, t0 + 0.12);
      g.gain.linearRampToValueAtTime(0, t0 + 0.9);
      am.connect(amG).connect(g.gain);
      o.connect(g).connect(E.sfxBus);
      o.start(t0);
      am.start(t0);
      o.stop(t0 + 1);
      am.stop(t0 + 1);
    },
    flutter: () => {
      for (let i = 0; i < 5; i++) this.#noise({ dur: 0.04, freq: 4200, q: 2, gain: 0.03, when: i * 0.06 });
    },
    zip: () => this.#tone({ f0: 500, f1: 1500, dur: 0.14, gain: 0.12, attack: 0.02, curve: 'lin' }),
    plink: () => this.#mallet(midi(72 + [0, 2, 4, 7, 9, 12][Math.floor(Math.random() * 6)]), { gain: 0.16, dur: 0.35 }),
  };
}

/** Quiet, ever-changing background: breeze and birdsong by day, crickets at night. */
export class Ambience {
  /** @param {import('./engine.js').AudioEngine} engine */
  constructor(engine) {
    this.engine = engine;
    this.started = false;
    this.night = 0;
    this.enabled = true;
    this.nextBird = 2;
    this.nextCricket = 1;
  }

  start() {
    const E = this.engine;
    if (this.started || !E.ready) return;
    this.started = true;
    const c = E.ctx;
    // breeze: slowly breathing filtered noise
    const s = c.createBufferSource();
    s.buffer = E.noise;
    s.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 120;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0.05;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoG = c.createGain();
    lfoG.gain.value = 0.025;
    lfo.connect(lfoG).connect(this.windGain.gain);
    s.connect(lp).connect(hp).connect(this.windGain).connect(E.ambientBus);
    s.start();
    lfo.start();
  }

  #bird() {
    const E = this.engine, c = E.ctx;
    const base = rnd(2400, 3900);
    const n = 2 + Math.floor(Math.random() * 4);
    const gap = rnd(0.09, 0.16);
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = rnd(-0.8, 0.8);
      pan.connect(E.ambientBus);
    }
    const dest = pan || E.ambientBus;
    for (let i = 0; i < n; i++) {
      const t0 = c.currentTime + i * gap;
      const o = c.createOscillator();
      o.type = 'sine';
      const f = base * rnd(0.9, 1.15);
      o.frequency.setValueAtTime(f, t0);
      o.frequency.exponentialRampToValueAtTime(f * rnd(1.15, 1.5), t0 + 0.04);
      o.frequency.exponentialRampToValueAtTime(f * rnd(0.8, 1.0), t0 + 0.09);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.045, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.1);
      o.connect(g).connect(dest);
      o.start(t0);
      o.stop(t0 + 0.12);
    }
  }

  #cricket() {
    const E = this.engine, c = E.ctx;
    const f = rnd(4300, 5000);
    const pulses = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pulses; i++) {
      const t0 = c.currentTime + i * 0.055;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.014, t0 + 0.008);
      g.gain.linearRampToValueAtTime(0, t0 + 0.035);
      o.connect(g).connect(E.ambientBus);
      o.start(t0);
      o.stop(t0 + 0.05);
    }
  }

  update(dt, night) {
    if (!this.started || !this.engine.ready) return;
    this.night = night;
    const E = this.engine;
    E.ambientBus.gain.setTargetAtTime(this.enabled ? 0.5 : 0, E.ctx.currentTime, 0.3);
    if (!this.enabled) return;
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      this.nextBird = rnd(2.5, 9) / Math.max(0.15, 1 - night);
      if (night < 0.7) this.#bird();
    }
    this.nextCricket -= dt;
    if (this.nextCricket <= 0) {
      this.nextCricket = rnd(0.35, 1.3);
      if (night > 0.4) this.#cricket();
    }
  }
}
