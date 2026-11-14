// Remembers settings and a few facts between visits (on this device only).
const KEY = 'lumi.v1';

export const DEFAULT_SETTINGS = {
  volume: 0.85,
  lang: 'auto', // 'auto' follows the device language, or a language code such as 'en', 'zh', 'es'
  mimic: true, // repeat what the child says (uses the microphone)
  ambience: true, // birds / breeze / crickets
  time: 'auto', // 'auto' follows the clock, or 'day' / 'night'
  quality: 'auto', // 'auto' | 'low' | 'medium' | 'high'
};

export class Store {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.data = { settings: { ...DEFAULT_SETTINGS }, firstRunDone: false, lastSeen: 0, visits: 0 };
    try {
      const raw = storage?.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        this.data = { ...this.data, ...saved, settings: { ...DEFAULT_SETTINGS, ...(saved.settings || {}) } };
      }
    } catch {
      /* private mode or corrupt data: start fresh */
    }
    this.listeners = [];
  }

  get settings() {
    return this.data.settings;
  }

  set(key, value) {
    this.data.settings[key] = value;
    this.save();
    for (const fn of this.listeners) fn(key, value);
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  save() {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage full or unavailable: settings just will not persist */
    }
  }
}
