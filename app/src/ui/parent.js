// The grown-ups' corner. There is nothing on screen to find by accident:
// press and hold the top-right corner for two seconds to open it.
import { stringsFor } from './strings.js';

const HOLD_MS = 2000;

const CSS = `
#lumi-hot { position: fixed; top: 0; right: 0; width: 72px; height: 72px; z-index: 20; touch-action: none; }
#lumi-hot .ring { position: absolute; top: 14px; right: 14px; width: 40px; height: 40px; border-radius: 50%;
  border: 3px solid rgba(255,255,255,.9); opacity: 0; transform: scale(.6); transition: opacity .2s, transform .2s; }
#lumi-hot.holding .ring { opacity: .9; transform: scale(1); animation: lumi-fill 2s linear forwards; }
@keyframes lumi-fill { from { box-shadow: inset 0 0 0 0 rgba(255,255,255,.85); } to { box-shadow: inset 0 0 0 20px rgba(255,255,255,.85); } }
#lumi-panel { position: fixed; inset: 0; z-index: 30; display: none; place-items: center; background: rgba(28, 22, 48, .45);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font: 16px/1.4 ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: #3b3350; touch-action: auto; user-select: none; -webkit-user-select: none; }
#lumi-panel.open { display: grid; }
#lumi-panel .card { box-sizing: border-box; width: min(92vw, 440px); max-height: 90vh; overflow: auto; background: #fffaf3; border-radius: 28px;
  padding: 22px 22px 18px; box-shadow: 0 24px 60px rgba(30, 20, 60, .35); }
#lumi-panel h2 { margin: 0 0 2px; font-size: 22px; color: #5a3fa0; }
#lumi-panel .sub { margin: 0 0 14px; font-size: 13px; color: #8a819c; }
#lumi-panel .row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 14px; padding: 11px 0; border-top: 1px solid #efe6da; }
#lumi-panel .row > span { flex: 1; word-break: keep-all; }
#lumi-panel .row small { display: block; color: #9a90aa; font-size: 12px; margin-top: 2px; word-break: normal; }
#lumi-panel input[type=range] { width: 46%; accent-color: #8f6be0; }
#lumi-panel select { font: inherit; font-size: 15px; color: #5a3fa0; background: #efe6f8; border: 0; border-radius: 12px; padding: 8px 10px; max-width: 52%; }
#lumi-panel .seg { display: flex; flex: none; max-width: 100%; box-sizing: border-box; background: #efe6f8; border-radius: 14px; padding: 3px; }
#lumi-panel .seg button { border: 0; background: transparent; padding: 7px 9px; border-radius: 11px; font: inherit; font-size: 14px; color: #6a5a8c; white-space: nowrap; }
#lumi-panel .seg button.on { background: #8f6be0; color: #fff; }
#lumi-panel .switch { position: relative; width: 52px; height: 30px; border-radius: 15px; border: 0; background: #d9d0e6; transition: background .2s; flex: none; }
#lumi-panel .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%; background: #fff; transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
#lumi-panel .switch.on { background: #8f6be0; }
#lumi-panel .switch.on::after { transform: translateX(22px); }
#lumi-panel .actions { display: flex; gap: 10px; margin-top: 14px; }
#lumi-panel .btn { flex: 1; word-break: keep-all; border: 0; border-radius: 16px; padding: 12px; font: inherit; font-weight: 600; background: #efe6f8; color: #5a3fa0; }
#lumi-panel .btn.primary { background: #8f6be0; color: #fff; }
#lumi-panel .note { margin: 12px 0 0; font-size: 12px; color: #9a90aa; }
`;

export class ParentPanel {
  /**
   * @param {import('../brain/store.js').Store} store
   * @param {{onBedtime: () => void, micState: () => string, languages: () => {code: string, name: string}[],
   *          resolveLang: (pref: string) => string, onOpen?: () => void, onClose?: () => void}} hooks
   */
  constructor(store, hooks) {
    this.store = store;
    this.hooks = hooks;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.hot = document.createElement('div');
    this.hot.id = 'lumi-hot';
    this.hot.setAttribute('aria-label', stringsFor('en').corner);
    this.hot.innerHTML = '<div class="ring"></div>';
    document.body.appendChild(this.hot);
    let timer = null;
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
      this.hot.classList.remove('holding');
    };
    this.hot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.hot.classList.add('holding');
      timer = setTimeout(() => {
        cancel();
        this.open();
      }, HOLD_MS);
    });
    for (const t of ['pointerup', 'pointerleave', 'pointercancel']) this.hot.addEventListener(t, cancel);
    this.hot.addEventListener('contextmenu', (e) => e.preventDefault());

    this.el = document.createElement('div');
    this.el.id = 'lumi-panel';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', stringsFor('en').title);
    document.body.appendChild(this.el);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.close();
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  get isOpen() {
    return this.el.classList.contains('open');
  }

  open() {
    this.#render();
    this.el.classList.add('open');
    this.hooks.onOpen?.();
  }

  close() {
    this.el.classList.remove('open');
    this.hooks.onClose?.();
  }

  #render() {
    const s = this.store.settings;
    const code = this.hooks.resolveLang(s.lang);
    const t = stringsFor(code);
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    this.el.lang = code;
    this.el.setAttribute('aria-label', t.title);
    this.hot.setAttribute('aria-label', t.corner);
    const mic = this.hooks.micState();
    const micNote = { denied: t.micDenied, unsupported: t.micUnsupported, starting: t.micStarting }[mic] || t.mimicNote;
    const seg = (key, options) =>
      `<div class="seg" data-key="${key}">${options.map(([v, label]) => `<button data-v="${v}" class="${s[key] === v ? 'on' : ''}">${esc(label)}</button>`).join('')}</div>`;
    const langs = [['auto', t.languageAuto], ...this.hooks.languages().map((l) => [l.code, l.name])];
    this.el.innerHTML = `
      <div class="card">
        <h2>${esc(t.title)}</h2>
        <p class="sub">${esc(t.intro)}</p>
        <div class="row"><span>${esc(t.language)}</span><select data-key="lang" aria-label="${esc(t.language)}">${langs
          .map(([v, label]) => `<option value="${esc(v)}"${s.lang === v ? ' selected' : ''}>${esc(label)}</option>`)
          .join('')}</select></div>
        <div class="row"><span>${esc(t.volume)}</span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-key="volume" aria-label="${esc(t.volume)}"></div>
        <div class="row"><span>${esc(t.mimic)}<small>${esc(micNote)}</small></span><button class="switch ${s.mimic ? 'on' : ''}" data-key="mimic" role="switch" aria-checked="${s.mimic}" aria-label="${esc(t.mimic)}"></button></div>
        <div class="row"><span>${esc(t.ambience)}</span><button class="switch ${s.ambience ? 'on' : ''}" data-key="ambience" role="switch" aria-checked="${s.ambience}" aria-label="${esc(t.ambience)}"></button></div>
        <div class="row"><span>${esc(t.time)}</span>${seg('time', [['auto', t.timeAuto], ['day', t.timeDay], ['night', t.timeNight]])}</div>
        <div class="row"><span>${esc(t.quality)}</span>${seg('quality', [['auto', t.qualityAuto], ['low', t.qualityLow], ['medium', t.qualityMedium], ['high', t.qualityHigh]])}</div>
        <div class="actions">
          <button class="btn" data-act="bedtime">${esc(t.bedtime)}</button>
          <button class="btn primary" data-act="close">${esc(t.done)}</button>
        </div>
        <p class="note">${esc(t.privacy)}</p>
      </div>`;
    this.el.querySelector('select').addEventListener('change', (e) => {
      this.store.set('lang', e.target.value);
      this.#render();
    });
    this.el.querySelector('input[type=range]').addEventListener('input', (e) => this.store.set('volume', Number(e.target.value)));
    for (const sw of this.el.querySelectorAll('.switch')) {
      sw.addEventListener('click', () => {
        const key = sw.dataset.key;
        this.store.set(key, !this.store.settings[key]);
        this.#render();
      });
    }
    for (const group of this.el.querySelectorAll('.seg')) {
      for (const b of group.querySelectorAll('button')) {
        b.addEventListener('click', () => {
          this.store.set(group.dataset.key, b.dataset.v);
          this.#render();
        });
      }
    }
    this.el.querySelector('[data-act=close]').addEventListener('click', () => this.close());
    this.el.querySelector('[data-act=bedtime]').addEventListener('click', () => {
      this.hooks.onBedtime();
      this.close();
    });
  }
}
