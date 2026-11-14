// "Say something and Lumi says it back": listens on the microphone, finds
// where a spoken phrase starts and ends, and hands that snippet over to be
// replayed in Lumi's squeaky voice. Audio stays in memory on this device only
// and is discarded right after it is played.

const PRE_ROLL = 0.3; // seconds kept from before speech was detected
const HANG = 0.7; // silence that ends a phrase
const MIN_VOICED = 0.22;
const MAX_LEN = 7;

export class Mimic {
  /** @param {import('./engine.js').AudioEngine} engine */
  constructor(engine) {
    this.engine = engine;
    /** @type {'off'|'starting'|'listening'|'denied'|'unsupported'} */
    this.state = 'off';
    this.paused = false;
    this.onSpeechStart = () => {};
    this.onSpeechCancel = () => {};
    this.onUtterance = () => {};
    this.onState = () => {};
    this.level = 0;
    this.ticket = 0;
    this.#reset();
    this.floor = 0.004;
    this.ring = [];
    this.ringSamples = 0;
  }

  #reset() {
    this.recording = false;
    this.frames = [];
    this.samples = 0;
    this.loudRun = 0;
    this.voiced = 0;
    this.sinceLoud = 0;
  }

  #setState(s) {
    this.state = s;
    this.onState(s);
  }

  get supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /** Ask for the microphone and start listening. Call from a user gesture. */
  async start() {
    if (this.state === 'listening' || this.state === 'starting') return;
    if (!this.supported || !this.engine.ctx) {
      this.#setState('unsupported');
      return;
    }
    this.#setState('starting');
    // Every start() gets a ticket; stop() and later start()s make older tickets stale.
    // A permission prompt can take a long time, and the page may be hidden and shown
    // again meanwhile: a stale request must let its own microphone go, never keep it.
    const ticket = ++this.ticket;
    const current = () => ticket === this.ticket && this.state === 'starting';
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch {
      if (current()) this.#setState('denied');
      return;
    }
    if (!current()) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    const c = this.engine.ctx;
    let node;
    try {
      if (!c.audioWorklet) throw new Error('no worklet');
      await c.audioWorklet.addModule(new URL('./recorder-worklet.js', import.meta.url));
      if (!current()) return; // stop() already released the stream
      node = new AudioWorkletNode(c, 'lumi-recorder', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      node.port.onmessage = (e) => this.feed(e.data);
    } catch {
      if (!current()) return;
      // older browsers
      node = c.createScriptProcessor(1024, 1, 1);
      node.onaudioprocess = (e) => this.feed(new Float32Array(e.inputBuffer.getChannelData(0)));
    }
    this.node = node;
    this.source = c.createMediaStreamSource(stream);
    const sink = c.createGain();
    sink.gain.value = 0; // keeps the graph pulling without making sound
    sink.connect(c.destination);
    this.sink = sink;
    this.source.connect(node);
    node.connect(sink);
    this.#setState('listening');
  }

  stop() {
    this.ticket++; // any start() still waiting on a permission prompt is now stale
    try {
      this.source?.disconnect();
      this.node?.disconnect();
      this.sink?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* already gone */
    }
    this.source = this.node = this.stream = this.sink = null;
    if (this.recording) this.onSpeechCancel();
    this.#reset();
    this.#setState('off');
  }

  /** Process one block of microphone samples (about 20 ms). */
  feed(block) {
    const rate = this.engine.ctx.sampleRate;
    const dt = block.length / rate;
    let sum = 0;
    for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
    const rms = Math.sqrt(sum / block.length);
    this.level = rms;

    // ignore the microphone while Lumi herself is making sound
    if (this.paused || this.engine.speaking) {
      if (this.recording) {
        this.onSpeechCancel();
        this.#reset();
      }
      this.ring.length = 0;
      this.ringSamples = 0;
      this.loudRun = 0;
      return;
    }

    // track the room's background level: follow drops quickly, rises slowly
    if (rms < this.floor) this.floor = this.floor * 0.7 + rms * 0.3;
    else if (!this.recording) this.floor += (rms - this.floor) * 0.004;
    this.floor = Math.max(0.0012, Math.min(0.05, this.floor));
    const threshold = Math.max(0.016, this.floor * 4.2);
    const loud = rms > threshold;

    if (!this.recording) {
      this.ring.push(block);
      this.ringSamples += block.length;
      while (this.ringSamples - this.ring[0].length > PRE_ROLL * rate) this.ringSamples -= this.ring.shift().length;
      this.loudRun = loud ? this.loudRun + 1 : 0;
      if (this.loudRun >= 3) {
        this.recording = true;
        this.frames = this.ring.slice();
        this.samples = this.ringSamples;
        this.ring = [];
        this.ringSamples = 0;
        this.voiced = this.loudRun * dt;
        this.sinceLoud = 0;
        this.onSpeechStart();
      }
      return;
    }

    this.frames.push(block);
    this.samples += block.length;
    if (loud) {
      this.voiced += dt;
      this.sinceLoud = 0;
    } else {
      this.sinceLoud += dt;
    }
    const length = this.samples / rate;
    if (this.sinceLoud >= HANG || length >= MAX_LEN) {
      const frames = this.frames, total = this.samples, voiced = this.voiced, tail = this.sinceLoud;
      this.#reset();
      if (voiced < MIN_VOICED) {
        this.onSpeechCancel();
        return;
      }
      // drop most of the trailing silence
      const keep = Math.max(1, total - Math.floor(Math.max(0, tail - 0.12) * rate));
      const data = new Float32Array(keep);
      let o = 0;
      for (const f of frames) {
        if (o >= keep) break;
        const n = Math.min(f.length, keep - o);
        data.set(n === f.length ? f : f.subarray(0, n), o);
        o += n;
      }
      let peak = 0;
      for (let i = 0; i < keep; i++) peak = Math.max(peak, Math.abs(data[i]));
      const gain = Math.min(8, 0.8 / Math.max(peak, 1e-4));
      const fade = Math.floor(rate * 0.02);
      for (let i = 0; i < keep; i++) {
        let g = gain;
        if (i < fade) g *= i / fade;
        if (i > keep - fade) g *= (keep - i) / fade;
        data[i] *= g;
      }
      const buffer = this.engine.ctx.createBuffer(1, keep, rate);
      buffer.copyToChannel(data, 0);
      this.onUtterance(buffer, keep / rate);
    }
  }
}
