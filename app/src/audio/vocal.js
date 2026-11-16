// Lumi's wordless voice: giggles, yawns, coos, "wheee!" and singing.
//
// The sounds she makes most are recordings in the same voice as her words (see
// tools/voice/sounds.mjs), each with a few variants and played at a slightly
// different pitch every time. Everything else, and any of those until its
// recording has loaded, is made with a tiny formant synthesizer (a buzzy source
// shaped by vowel resonances), where every call is a little different too.

// vowel formants (Hz) tuned for a small, bright voice
const VOWELS = {
  a: [1050, 1750, 3300],
  e: [680, 2550, 3400],
  i: [420, 3000, 3800],
  o: [620, 1180, 3200],
  u: [440, 1020, 3000],
  m: [320, 1100, 2600],
};
const FORMANT_GAIN = [1.0, 0.55, 0.22];

const rnd = (a, b) => a + Math.random() * (b - a);

export class Vocal {
  /** @param {import('./engine.js').AudioEngine} engine */
  constructor(engine) {
    this.engine = engine;
    this.pitch = 1; // global pitch multiplier (mood can nudge it)
    /** Her recorded sounds, once main.js has handed them over. @type {import('./voiceLines.js').VoiceLines|null} */
    this.recordings = null;
  }

  /**
   * Play a recorded sound, if there is one.
   * @returns {number} end time offset (seconds from now), or 0 when the synthesizer should make it instead
   */
  #recorded(name, when) {
    const r = this.recordings?.say(name, { when, gain: 0.9, rate: this.pitch * rnd(0.97, 1.04) });
    return r ? when + r.duration : 0;
  }

  /**
   * One voiced syllable.
   * @param {{v?: string, v2?: string, f0: number, f1?: number, dur: number, gain?: number,
   *          onset?: 'h'|'l'|'m'|'p'|null, when?: number, vibrato?: number, breath?: number, attack?: number}} o
   * @returns {number} end time offset (seconds from now)
   */
  syl(o) {
    const E = this.engine;
    if (!E.ready) return 0;
    const c = E.ctx;
    const t0 = c.currentTime + (o.when || 0);
    const dur = o.dur;
    const gain = (o.gain ?? 1) * 0.3;
    const fA = o.f0 * this.pitch;
    const fB = (o.f1 ?? o.f0) * this.pitch;
    const onset = o.onset || null;
    const voiceStart = t0 + (onset === 'h' ? 0.035 : onset === 'p' ? 0.012 : 0);
    const attack = o.attack ?? 0.018;

    const out = c.createGain();
    out.gain.value = 0;
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 5200;
    tone.connect(out).connect(E.voiceBus);

    // source: saw + a quieter octave for sparkle, plus breath
    const src = c.createGain();
    const saw = c.createOscillator();
    saw.type = 'sawtooth';
    const tri = c.createOscillator();
    tri.type = 'triangle';
    const triGain = c.createGain();
    triGain.gain.value = 0.35;
    saw.frequency.setValueAtTime(fA, t0);
    saw.frequency.exponentialRampToValueAtTime(Math.max(40, fB), t0 + dur);
    tri.frequency.setValueAtTime(fA * 2, t0);
    tri.frequency.exponentialRampToValueAtTime(Math.max(80, fB * 2), t0 + dur);
    saw.connect(src);
    tri.connect(triGain).connect(src);
    if (o.vibrato) {
      const lfo = c.createOscillator();
      lfo.frequency.value = 5.6;
      const depth = c.createGain();
      depth.gain.value = fA * o.vibrato;
      lfo.connect(depth);
      depth.connect(saw.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.1);
    }
    const breath = c.createBufferSource();
    breath.buffer = E.noise;
    breath.loop = true;
    const breathGain = c.createGain();
    breathGain.gain.value = o.breath ?? 0.05;
    breath.connect(breathGain).connect(src);

    // formants (glide from vowel v to v2)
    const va = VOWELS[o.v || 'a'], vb = VOWELS[o.v2 || o.v || 'a'];
    for (let i = 0; i < 3; i++) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = i === 0 ? 5 : 8;
      bp.frequency.setValueAtTime(va[i], t0);
      if (vb !== va) bp.frequency.linearRampToValueAtTime(vb[i], t0 + dur * 0.8);
      if (onset === 'l') {
        // "l": start from a darker, closed shape
        bp.frequency.setValueAtTime(VOWELS.u[i], t0);
        bp.frequency.linearRampToValueAtTime(va[i], t0 + 0.06);
      }
      const g = c.createGain();
      g.gain.value = FORMANT_GAIN[i];
      src.connect(bp).connect(g).connect(tone);
    }

    // amplitude envelope
    const g = out.gain;
    g.setValueAtTime(0, t0);
    if (onset === 'h') {
      // breathy lead-in
      breathGain.gain.setValueAtTime(0.5, t0);
      breathGain.gain.linearRampToValueAtTime(o.breath ?? 0.05, voiceStart + 0.03);
      g.linearRampToValueAtTime(gain * 0.25, t0 + 0.02);
    } else if (onset === 'm') {
      g.linearRampToValueAtTime(gain * 0.3, t0 + 0.03);
    }
    g.linearRampToValueAtTime(gain, voiceStart + attack);
    g.setValueAtTime(gain, Math.max(voiceStart + attack, t0 + dur - 0.05));
    g.linearRampToValueAtTime(0, t0 + dur);

    const end = t0 + dur + 0.05;
    saw.start(t0);
    tri.start(t0);
    breath.start(t0, Math.random());
    saw.stop(end);
    tri.stop(end);
    breath.stop(end);
    E.markVoice((o.when || 0) + dur + 0.1);
    return (o.when || 0) + dur;
  }

  /** Filtered noise burst (breaths, "choo", munching, lip smacks). */
  noise({ when = 0, dur = 0.1, freq = 2000, q = 1, gain = 0.3, type = 'bandpass', sweepTo = null, attack = 0.005, bus = 'voice' }) {
    const E = this.engine;
    if (!E.ready) return 0;
    const c = E.ctx;
    const t0 = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = E.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(f).connect(g).connect(bus === 'voice' ? E.voiceBus : E.sfxBus);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.02);
    if (bus === 'voice') E.markVoice(when + dur + 0.1);
    return when + dur;
  }

  // ---- the repertoire --------------------------------------------------------

  giggle(when = 0) {
    const recorded = this.#recorded('giggle', when);
    if (recorded) return recorded;
    const n = 5 + Math.floor(Math.random() * 3);
    let t = when;
    let f = rnd(700, 780);
    for (let i = 0; i < n; i++) {
      this.syl({ v: i % 2 ? 'e' : 'i', f0: f, f1: f * 0.9, dur: 0.085, onset: 'h', when: t, gain: 0.85 - i * 0.05 });
      t += rnd(0.115, 0.14);
      f *= rnd(0.93, 0.98);
    }
    return t;
  }

  laugh(when = 0) {
    const n = 6 + Math.floor(Math.random() * 3);
    let t = when;
    let f = rnd(640, 700);
    for (let i = 0; i < n; i++) {
      this.syl({ v: 'a', f0: f, f1: f * 0.86, dur: 0.11, onset: 'h', when: t, gain: 0.95 - i * 0.05 });
      t += rnd(0.15, 0.18);
      f *= i === 2 ? 1.08 : rnd(0.93, 0.97);
    }
    return t;
  }

  whee(when = 0) {
    const recorded = this.#recorded('whee', when);
    if (recorded) return recorded;
    return this.syl({ v: 'i', f0: 520, f1: 940, dur: 0.6, when, vibrato: 0.012, gain: 0.9, onset: 'h' });
  }

  yay(when = 0) {
    const recorded = this.#recorded('yay', when);
    if (recorded) return recorded;
    this.syl({ v: 'i', v2: 'e', f0: 560, f1: 700, dur: 0.14, when, gain: 0.9 });
    return this.syl({ v: 'e', v2: 'i', f0: 760, f1: 620, dur: 0.42, when: when + 0.14, gain: 1, vibrato: 0.012 });
  }

  hup(when = 0) {
    const recorded = this.#recorded('hup', when);
    if (recorded) return recorded;
    return this.syl({ v: 'a', f0: 520, f1: 760, dur: 0.16, when, onset: 'h', gain: 0.8 });
  }

  oh(when = 0) {
    const recorded = this.#recorded('oh', when);
    if (recorded) return recorded;
    return this.syl({ v: 'o', f0: 480, f1: 700, dur: 0.26, when, gain: 0.85 });
  }

  huh(when = 0) {
    return this.syl({ v: 'a', v2: 'o', f0: 520, f1: 820, dur: 0.3, when, onset: 'h', gain: 0.75 });
  }

  aww(when = 0) {
    return this.syl({ v: 'a', v2: 'o', f0: 600, f1: 400, dur: 0.75, when, vibrato: 0.014, gain: 0.75 });
  }

  mmm(when = 0) {
    this.syl({ v: 'm', f0: 500, f1: 620, dur: 0.3, when, onset: 'm', gain: 0.9, breath: 0.01 });
    return this.syl({ v: 'm', f0: 620, f1: 460, dur: 0.5, when: when + 0.3, gain: 0.9, breath: 0.01, vibrato: 0.01 });
  }

  /** A soft happy purr-coo while being petted. */
  coo(when = 0) {
    const recorded = this.#recorded('coo', when);
    if (recorded) return recorded;
    const f = rnd(430, 520);
    this.syl({ v: 'u', v2: 'o', f0: f, f1: f * 1.18, dur: 0.34, when, gain: 0.6, onset: 'm', vibrato: 0.03 });
    return this.syl({ v: 'o', v2: 'u', f0: f * 1.18, f1: f * 0.95, dur: 0.4, when: when + 0.34, gain: 0.55, vibrato: 0.03 });
  }

  yawn(when = 0) {
    const recorded = this.#recorded('yawn', when);
    if (recorded) return recorded;
    this.noise({ when, dur: 0.5, freq: 900, q: 0.7, gain: 0.07, attack: 0.3 }); // breath in
    this.syl({ v: 'a', f0: 400, f1: 560, dur: 0.75, when: when + 0.4, gain: 0.7, breath: 0.2, attack: 0.25 });
    return this.syl({ v: 'a', v2: 'o', f0: 560, f1: 310, dur: 1.05, when: when + 1.15, gain: 0.7, breath: 0.25, vibrato: 0.01 });
  }

  achoo(when = 0) {
    // the big "CHOO" only: the wind-up "ah... ah..." is separate so it can follow the animation
    this.noise({ when, dur: 0.22, freq: 3200, q: 0.8, gain: 0.5, sweepTo: 1400 });
    return this.syl({ v: 'u', f0: 720, f1: 430, dur: 0.3, when: when + 0.05, gain: 0.9 });
  }

  ahAh(when = 0) {
    this.syl({ v: 'a', f0: 500, f1: 560, dur: 0.16, when, gain: 0.5, onset: 'h', breath: 0.3 });
    return this.syl({ v: 'a', f0: 560, f1: 660, dur: 0.24, when: when + 0.42, gain: 0.65, onset: 'h', breath: 0.3 });
  }

  kiss(when = 0) {
    const recorded = this.#recorded('kiss', when);
    if (recorded) return recorded;
    this.syl({ v: 'm', f0: 540, f1: 600, dur: 0.2, when, onset: 'm', gain: 0.7, breath: 0.01 });
    this.noise({ when: when + 0.2, dur: 0.05, freq: 2600, q: 3, gain: 0.5 });
    return this.syl({ v: 'a', f0: 640, f1: 560, dur: 0.22, when: when + 0.24, gain: 0.8 });
  }

  raspberry(when = 0) {
    const E = this.engine;
    if (!E.ready) return 0;
    const c = E.ctx, t0 = c.currentTime + when, dur = 0.7;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(95, t0);
    o.frequency.linearRampToValueAtTime(70, t0 + dur);
    const am = c.createOscillator();
    am.type = 'square';
    am.frequency.value = 27;
    const amG = c.createGain();
    amG.gain.value = 0.5;
    const g = c.createGain();
    g.gain.value = 0.5;
    am.connect(amG).connect(g.gain);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.3, t0 + 0.03);
    env.gain.setValueAtTime(0.3, t0 + dur - 0.1);
    env.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(lp).connect(g).connect(env).connect(E.voiceBus);
    o.start(t0);
    am.start(t0);
    o.stop(t0 + dur + 0.05);
    am.stop(t0 + dur + 0.05);
    this.noise({ when, dur, freq: 1500, q: 0.5, gain: 0.08 });
    E.markVoice(when + dur + 0.1);
    return when + dur;
  }

  chomp(when = 0) {
    this.noise({ when, dur: 0.09, freq: 1800, q: 1.2, gain: 0.5 });
    return this.syl({ v: 'a', v2: 'm', f0: 520, f1: 440, dur: 0.14, when: when + 0.02, gain: 0.7 });
  }

  munch(when = 0) {
    for (let i = 0; i < 2; i++) {
      this.noise({ when: when + i * 0.23, dur: 0.07, freq: rnd(1500, 2600), q: 1.5, gain: 0.3 });
      this.syl({ v: 'm', f0: rnd(430, 500), f1: 420, dur: 0.1, when: when + i * 0.23 + 0.03, gain: 0.4, onset: 'm', breath: 0.01 });
    }
    return when + 0.46;
  }

  gulp(when = 0) {
    const E = this.engine;
    if (!E.ready) return 0;
    const c = E.ctx, t0 = c.currentTime + when;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(330, t0);
    o.frequency.exponentialRampToValueAtTime(150, t0 + 0.07);
    o.frequency.exponentialRampToValueAtTime(520, t0 + 0.16);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.4, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
    o.connect(g).connect(E.voiceBus);
    o.start(t0);
    o.stop(t0 + 0.25);
    E.markVoice(when + 0.3);
    return when + 0.2;
  }

  /** One sleepy breath: soft air in, a tiny whistle out. */
  snore(when = 0) {
    this.noise({ when, dur: 1.1, freq: 500, q: 0.8, gain: 0.05, attack: 0.5, bus: 'sfx' });
    const E = this.engine;
    if (!E.ready) return 0;
    const c = E.ctx, t0 = c.currentTime + when + 1.3;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(980, t0);
    o.frequency.exponentialRampToValueAtTime(700, t0 + 0.9);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.035, t0 + 0.25);
    g.gain.linearRampToValueAtTime(0, t0 + 0.95);
    o.connect(g).connect(E.sfxBus);
    o.start(t0);
    o.stop(t0 + 1);
    return when + 2.3;
  }

  /** Short chatter in Lumi's own babble language (used for emphasis and replies). */
  babble(count = 4, when = 0, mood = 0) {
    const recorded = this.#recorded('babble', when);
    if (recorded) return recorded;
    const vowels = ['a', 'i', 'o', 'e', 'u'];
    let t = when;
    let f = rnd(560, 660) * (1 + mood * 0.12);
    for (let i = 0; i < count; i++) {
      const v = vowels[Math.floor(Math.random() * vowels.length)];
      const d = rnd(0.09, 0.17);
      const up = Math.random() < 0.5 ? rnd(1.05, 1.25) : rnd(0.82, 0.96);
      this.syl({ v, f0: f, f1: f * up, dur: d, when: t, onset: Math.random() < 0.5 ? 'l' : 'm', gain: 0.75 });
      t += d + rnd(0.02, 0.06);
      f = Math.max(460, Math.min(820, f * up));
    }
    return t;
  }

  /**
   * Sing "la la la" to a melody.
   * @param {[number, number][]} notes [midiNote, beats]
   * @param {number} bpm
   * @returns {number} duration in seconds
   */
  sing(notes, bpm = 104, when = 0) {
    const beat = 60 / bpm;
    let t = when;
    for (const [midi, beats] of notes) {
      if (midi > 0) {
        const f = 440 * Math.pow(2, (midi - 69) / 12);
        this.syl({ v: 'a', f0: f, f1: f, dur: beats * beat * 0.86, when: t, onset: 'l', gain: 0.8, vibrato: beats >= 2 ? 0.012 : 0.004 });
      }
      t += beats * beat;
    }
    return t - when;
  }
}

// "Twinkle, twinkle" (public domain), in a comfy key for a tiny voice
export const TUNE_TWINKLE = [
  [72, 1], [72, 1], [79, 1], [79, 1], [81, 1], [81, 1], [79, 2],
  [77, 1], [77, 1], [76, 1], [76, 1], [74, 1], [74, 1], [72, 2],
];
// a happy little original ditty
export const TUNE_HAPPY = [
  [76, 0.5], [79, 0.5], [84, 1], [83, 0.5], [81, 0.5], [79, 1], [76, 0.5], [77, 0.5], [79, 1], [74, 0.5], [76, 0.5], [72, 2],
];
// a slow lullaby phrase (original)
export const TUNE_LULLABY = [
  [76, 2], [74, 1], [72, 2], [69, 1], [72, 2], [74, 1], [72, 3], [0, 1], [74, 2], [72, 1], [69, 2], [67, 1], [69, 3], [67, 3],
];
