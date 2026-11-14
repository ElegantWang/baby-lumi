// Plays Lumi's pre-rendered spoken lines (see tools/build-voice.mjs), in
// whichever language has been chosen. Only that language's audio is downloaded.

export class VoiceLines {
  /** @param {import('./engine.js').AudioEngine} engine */
  constructor(engine, baseUrl = 'assets/voice/') {
    this.engine = engine;
    this.baseUrl = baseUrl;
    /** @type {{code: string, name: string}[]} */
    this.languages = [];
    this.defaultLang = 'en';
    this.lang = null;
    this.manifest = null;
    this.raw = new Map(); // id -> ArrayBuffer (compressed)
    this.buffers = new Map(); // id -> AudioBuffer (decoded)
    this.lastPick = new Map();
    this.current = null;
    this.generation = 0; // bumps on every language change, so stale downloads are dropped
  }

  /** Find out which languages are available. */
  async init() {
    try {
      const res = await fetch(this.baseUrl + 'languages.json');
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      this.languages = data.languages || [];
      this.defaultLang = data.default || this.languages[0]?.code || 'en';
    } catch (e) {
      console.warn('[lumi] could not list languages:', e.message);
      this.languages = [{ code: 'en', name: 'English' }];
    }
    return this.languages;
  }

  /**
   * Turn a setting ('auto' or a language code) into a language we actually have.
   * 'auto' takes the first of the device's preferred languages that Lumi speaks.
   * @param {string} pref
   * @param {readonly string[]} preferred e.g. navigator.languages
   */
  resolve(pref, preferred = globalThis.navigator?.languages || []) {
    const has = (code) => this.languages.some((l) => l.code === code);
    if (pref && pref !== 'auto') return has(pref) ? pref : this.defaultLang;
    for (const tag of preferred) {
      const primary = String(tag).toLowerCase().split('-')[0];
      if (has(primary)) return primary;
    }
    return this.defaultLang;
  }

  /** Switch language: loads its manifest and quietly warms the cache. */
  async setLanguage(code) {
    if (code === this.lang && this.manifest) return;
    const gen = ++this.generation;
    this.stop();
    this.lang = code;
    let manifest;
    try {
      const res = await fetch(`${this.baseUrl}${code}/manifest.json`);
      if (!res.ok) throw new Error(String(res.status));
      manifest = await res.json();
    } catch (e) {
      console.warn(`[lumi] voice lines for "${code}" unavailable:`, e.message);
      manifest = { lines: {}, groups: {} };
    }
    if (gen !== this.generation) return; // a newer choice was made meanwhile
    this.manifest = manifest;
    this.raw = new Map();
    this.buffers = new Map();
    this.lastPick = new Map();
    // warm the cache in the background so speech starts instantly later
    this.#prefetchAll(gen);
  }

  /** Backwards-compatible: load the default language. */
  async load() {
    if (!this.languages.length) await this.init();
    await this.setLanguage(this.resolve('auto'));
  }

  async #prefetchAll(gen) {
    const ids = Object.keys(this.manifest.lines);
    const worker = async () => {
      while (ids.length && gen === this.generation) {
        const id = ids.shift();
        try {
          await this.#fetch(id, gen);
        } catch {
          /* fetched again on demand */
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  async #fetch(id, gen = this.generation) {
    if (this.raw.has(id)) return this.raw.get(id);
    const v = this.manifest.build ? `?v=${this.manifest.build}` : '';
    const res = await fetch(`${this.baseUrl}${this.lang}/${id}.m4a${v}`);
    if (!res.ok) throw new Error(`voice line ${id}: ${res.status}`);
    const buf = await res.arrayBuffer();
    if (gen === this.generation) this.raw.set(id, buf);
    return buf;
  }

  async #buffer(id, gen) {
    if (this.buffers.has(id)) return this.buffers.get(id);
    const raw = await this.#fetch(id, gen);
    const audio = await this.engine.ctx.decodeAudioData(raw.slice(0));
    if (gen === this.generation) this.buffers.set(id, audio);
    return audio;
  }

  has(group) {
    return !!this.manifest?.groups[group]?.length || !!this.manifest?.lines[group];
  }

  /** Pick a line id from a group, avoiding an immediate repeat. */
  pick(group) {
    if (this.manifest?.lines[group]) return group;
    const ids = this.manifest?.groups[group];
    if (!ids || !ids.length) return null;
    const last = this.lastPick.get(group);
    const pool = ids.length > 1 ? ids.filter((i) => i !== last) : ids;
    const id = pool[Math.floor(Math.random() * pool.length)];
    this.lastPick.set(group, id);
    return id;
  }

  /** Expected duration of a specific line in seconds. */
  duration(id) {
    return this.manifest?.lines[id]?.d ?? 0;
  }

  text(id) {
    return this.manifest?.lines[id]?.t ?? '';
  }

  stop() {
    this.current?.stop();
    this.current = null;
    this.pending = null;
  }

  /**
   * Say a line (by group name or exact id). Interrupts whatever she was saying.
   * @returns {{id: string, duration: number}|null} what will be said, or null if nothing can be
   */
  say(group, { gain = 1, rate = 1 } = {}) {
    const id = this.pick(group);
    if (!id || !this.engine.ready) return null;
    this.stop();
    const duration = this.duration(id) / rate;
    const ticket = {};
    const gen = this.generation;
    this.pending = ticket;
    this.engine.markVoice(duration + 0.3);
    this.#buffer(id, gen)
      .then((buf) => {
        if (this.pending !== ticket || gen !== this.generation) return; // something newer took over
        this.current = this.engine.playBuffer(buf, { bus: 'voice', gain, rate });
      })
      .catch((e) => console.warn('[lumi] could not play', id, e.message));
    return { id, duration };
  }
}
