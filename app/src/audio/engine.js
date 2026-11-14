// Web Audio backbone: buses, limiter, voice analysis for lip-sync.
// Nothing makes sound until unlock() is called from a user gesture.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.unlocked = false;
    this.volume = 1;
    this.muted = false;
    this.voiceActiveUntil = 0;
    this._time = new Float32Array(1024);
    this._freq = new Uint8Array(512);
    this._level = 0;
    this._wide = 0;
  }

  /** Create / resume the audio context. Must be called inside a tap or click. */
  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const c = this.ctx;
      this.master = c.createGain();
      this.limiter = c.createDynamicsCompressor();
      this.limiter.threshold.value = -9;
      this.limiter.knee.value = 8;
      this.limiter.ratio.value = 8;
      this.limiter.attack.value = 0.004;
      this.limiter.release.value = 0.18;
      this.master.connect(this.limiter).connect(c.destination);

      this.voiceBus = c.createGain(); // Lumi's voice: speech, babble, mimicry
      this.sfxBus = c.createGain();
      this.ambientBus = c.createGain();
      this.voiceBus.gain.value = 1.0;
      this.sfxBus.gain.value = 0.7;
      this.ambientBus.gain.value = 0.5;
      this.analyser = c.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.35;
      this.voiceBus.connect(this.analyser);
      this.voiceBus.connect(this.master);
      this.sfxBus.connect(this.master);
      this.ambientBus.connect(this.master);
      this.#applyVolume();

      // shared noise buffer for breathy / percussive sounds
      const len = c.sampleRate * 2;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* will try again on the next gesture */
      }
    }
    // iOS: a silent blip inside the gesture fully opens the output
    const b = this.ctx.createBufferSource();
    b.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    b.connect(this.ctx.destination);
    b.start();
    this.unlocked = this.ctx.state === 'running';
    return this.unlocked;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.#applyVolume();
  }

  setMuted(m) {
    this.muted = m;
    this.#applyVolume();
  }

  #applyVolume() {
    if (!this.master) return;
    const g = this.muted ? 0 : this.volume * 0.9;
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
  }

  /** Pause all sound when the app is hidden, resume when it returns. */
  setSuspended(s) {
    if (!this.ctx) return;
    if (s) this.ctx.suspend().catch(() => {});
    else if (this.unlocked) this.ctx.resume().catch(() => {});
  }

  /** Mark the voice as busy for `seconds` (so the microphone ignores Lumi herself). */
  markVoice(seconds) {
    if (!this.ctx) return;
    this.voiceActiveUntil = Math.max(this.voiceActiveUntil, this.ctx.currentTime + seconds);
  }

  get speaking() {
    return !!this.ctx && this.ctx.currentTime < this.voiceActiveUntil;
  }

  /**
   * Play an AudioBuffer.
   * @returns {{stop: () => void, duration: number, ended: Promise<void>} | null}
   */
  playBuffer(buffer, { bus = 'sfx', rate = 1, gain = 1, detune = 0, when = 0 } = {}) {
    if (!this.ready || !buffer) return null;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    if (detune) src.detune.value = detune;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g).connect(bus === 'voice' ? this.voiceBus : bus === 'ambient' ? this.ambientBus : this.sfxBus);
    const start = c.currentTime + when;
    src.start(start);
    const duration = buffer.duration / rate;
    if (bus === 'voice') this.markVoice(when + duration + 0.15);
    let resolve;
    const ended = new Promise((r) => (resolve = r));
    src.onended = () => resolve();
    return {
      duration,
      ended,
      stop: () => {
        try {
          g.gain.setTargetAtTime(0, c.currentTime, 0.02);
          src.stop(c.currentTime + 0.08);
        } catch {
          /* already stopped */
        }
      },
    };
  }

  /**
   * How loud and how "bright" Lumi's voice is right now, for lip-sync.
   * @returns {{level: number, wide: number}} level 0..1, wide -1 (oo) .. 1 (ee)
   */
  voiceShape() {
    if (!this.ready) return { level: 0, wide: 0 };
    this.analyser.getFloatTimeDomainData(this._time);
    let sum = 0;
    for (let i = 0; i < this._time.length; i++) sum += this._time[i] * this._time[i];
    const rms = Math.sqrt(sum / this._time.length);
    const level = Math.max(0, Math.min(1, (rms - 0.012) * 7.5));
    this.analyser.getByteFrequencyData(this._freq);
    // spectral centroid over the speech band
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    let num = 0, den = 0;
    const hi = Math.min(this._freq.length, Math.floor(5000 / binHz));
    for (let i = Math.floor(250 / binHz); i < hi; i++) {
      const m = this._freq[i];
      num += m * i * binHz;
      den += m;
    }
    const centroid = den > 0 ? num / den : 1200;
    const wide = Math.max(-1, Math.min(1, (centroid - 1500) / 900));
    this._level = level;
    this._wide += (wide - this._wide) * 0.25;
    return { level, wide: this._wide };
  }
}
