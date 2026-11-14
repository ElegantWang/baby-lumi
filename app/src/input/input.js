// Touch / mouse input for small hands: taps, strokes, swipes, holds and
// whole-palm "hugs", resolved to the part of Lumi (or the world) under the finger.
import * as THREE from 'three';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _w = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

const TAP_MAX_MS = 520;
const DRAG_PX = 14;
const HOLD_MS = 620;
const SWIPE_PX = 64;

/** Distance from a ray to a segment; returns the ray parameter of the hit or -1. */
function rayCapsule(o, d, a, b, r) {
  _ab.subVectors(b, a);
  _w.subVectors(o, a);
  const abab = _ab.dot(_ab), dab = d.dot(_ab), wd = _w.dot(d), wab = _w.dot(_ab);
  const denom = abab - dab * dab;
  let s = denom > 1e-9 ? (wab - wd * dab) / denom : 0;
  s = Math.max(0, Math.min(1, s));
  let t = -wd + s * dab;
  if (t < 0) t = 0;
  // closest points
  const px = o.x + d.x * t - (a.x + _ab.x * s);
  const py = o.y + d.y * t - (a.y + _ab.y * s);
  const pz = o.z + d.z * t - (a.z + _ab.z * s);
  const dist2 = px * px + py * py + pz * pz;
  if (dist2 > r * r) return -1;
  return Math.max(0, t - Math.sqrt(r * r - dist2));
}

export class Input {
  /**
   * @param {HTMLElement} el
   * @param {THREE.Camera} camera
   * @param {import('../character/lumi.js').Lumi} lumi
   */
  constructor(el, camera, lumi) {
    this.el = el;
    this.camera = camera;
    this.lumi = lumi;
    this.handlers = {};
    this.pointers = new Map();
    this.propPickers = []; // functions (ray) => { prop, t } | null
    this.enabled = true;
    this.lastActivity = performance.now();

    const H = lumi.header;
    this.colliders = H.colliders.map((c) => ({ ...c }));
    for (const e of H.eyes) {
      this.colliders.push({ name: 'eye' + e.side, bone: 'head', a: e.center, b: e.center, r: 0.095, priority: 4 });
    }
    this.colliders.push({ name: 'star', bone: 'head', a: H.star.center, b: H.star.center, r: 0.062, priority: 4 });

    const opts = { passive: false };
    el.addEventListener('pointerdown', (e) => this.#down(e), opts);
    el.addEventListener('pointermove', (e) => this.#move(e), opts);
    el.addEventListener('pointerup', (e) => this.#up(e), opts);
    el.addEventListener('pointercancel', (e) => this.#cancel(e), opts);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // belt and braces against browser gestures (zoom, scroll, text selection)
    for (const type of ['touchstart', 'touchmove', 'gesturestart', 'gesturechange', 'dblclick', 'wheel']) {
      el.addEventListener(type, (e) => e.preventDefault(), opts);
    }
  }

  on(type, fn) {
    (this.handlers[type] ||= []).push(fn);
  }

  #emit(type, data) {
    this.lastActivity = performance.now();
    for (const fn of this.handlers[type] || []) fn(data);
  }

  #ray(clientX, clientY) {
    const rect = this.el.getBoundingClientRect();
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(_ndc, this.camera);
    _o.copy(raycaster.ray.origin);
    _d.copy(raycaster.ray.direction);
    return { ndc: _ndc.clone() };
  }

  /** What is under this screen point? */
  pick(clientX, clientY) {
    const { ndc } = this.#ray(clientX, clientY);
    // props first (bubbles, snacks, butterflies float in front)
    let best = null;
    for (const picker of this.propPickers) {
      const hit = picker(_o, _d);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    // Lumi
    let front = Infinity;
    const hits = [];
    for (const c of this.colliders) {
      const bone = this.lumi.bones[c.bone];
      const rest = bone.userData.rest;
      _a.set(c.a[0] - rest.x, c.a[1] - rest.y, c.a[2] - rest.z).applyMatrix4(bone.matrixWorld);
      _b.set(c.b[0] - rest.x, c.b[1] - rest.y, c.b[2] - rest.z).applyMatrix4(bone.matrixWorld);
      const t = rayCapsule(_o, _d, _a, _b, c.r + 0.018);
      if (t >= 0) {
        hits.push({ c, t });
        if (t < front) front = t;
      }
    }
    let part = null, partT = Infinity;
    for (const h of hits) {
      // a higher-priority part wins only if it is not hidden behind something else
      if (h.t > front + 0.16) continue;
      if (!part || h.c.priority > part.priority || (h.c.priority === part.priority && h.t < partT)) {
        part = h.c;
        partT = h.t;
      }
    }
    if (best && (!part || best.t < partT + 0.25)) {
      return { kind: 'prop', prop: best.prop, point: new THREE.Vector3().copy(_o).addScaledVector(_d, best.t), ndc };
    }
    if (part) {
      return { kind: 'lumi', part: part.name, point: new THREE.Vector3().copy(_o).addScaledVector(_d, partT), ndc };
    }
    // ground (roughly flat near the hilltop) or sky
    if (_d.y < -0.02) {
      const t = -_o.y / _d.y;
      const p = new THREE.Vector3().copy(_o).addScaledVector(_d, t);
      if (t > 0 && p.length() < 5.5) return { kind: 'ground', point: p, ndc };
    }
    const t = (0.75 - _o.z) / _d.z;
    return { kind: 'sky', point: new THREE.Vector3().copy(_o).addScaledVector(_d, Math.max(0.5, t)), ndc };
  }

  /** World point under the pointer on a camera-facing plane through `through`. */
  pointOnPlane(clientX, clientY, through, out = new THREE.Vector3()) {
    this.#ray(clientX, clientY);
    const n = _w.copy(this.camera.position).sub(through).normalize();
    const denom = _d.dot(n);
    if (Math.abs(denom) < 1e-5) return out.copy(through);
    const t = _a.copy(through).sub(_o).dot(n) / denom;
    return out.copy(_o).addScaledVector(_d, t);
  }

  #down(e) {
    e.preventDefault();
    if (!this.enabled) return;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    const hit = this.pick(e.clientX, e.clientY);
    const p = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(),
      hit, dragging: false, held: false, lastPet: 0, vx: 0, vy: 0, lastT: performance.now(), travelled: 0,
    };
    this.pointers.set(e.pointerId, p);
    this.#emit('down', { hit, x: e.clientX, y: e.clientY, pointers: this.pointers.size });
    // a whole palm (three or more fingers) on Lumi is a hug
    if (this.pointers.size >= 3) {
      let onLumi = 0;
      for (const q of this.pointers.values()) if (q.hit.kind === 'lumi') onLumi++;
      if (onLumi >= 2) {
        for (const q of this.pointers.values()) q.held = true;
        this.#emit('hug', {});
      }
    }
    p.holdTimer = setTimeout(() => {
      if (this.pointers.get(p.id) === p && !p.dragging && !p.held) {
        p.held = true;
        this.#emit('hold', { hit: p.hit });
      }
    }, HOLD_MS);
  }

  #move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') this.#emit('hover', { x: e.clientX, y: e.clientY });
      return;
    }
    e.preventDefault();
    const now = performance.now();
    const dt = Math.max(1, now - p.lastT);
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.vx = p.vx * 0.6 + (dx / dt) * 0.4;
    p.vy = p.vy * 0.6 + (dy / dt) * 0.4;
    p.travelled += Math.hypot(dx, dy);
    p.x = e.clientX;
    p.y = e.clientY;
    p.lastT = now;
    if (!p.dragging && Math.hypot(p.x - p.x0, p.y - p.y0) > DRAG_PX) {
      p.dragging = true;
      clearTimeout(p.holdTimer);
      this.#emit('dragstart', { start: p.hit, x: p.x, y: p.y, id: p.id });
    }
    if (p.dragging) {
      this.#emit('drag', { start: p.hit, x: p.x, y: p.y, dx, dy, id: p.id });
      // stroking: report what the finger is passing over, a few times a second
      if (now - p.lastPet > 70) {
        p.lastPet = now;
        const over = this.pick(p.x, p.y);
        if (over.kind === 'lumi') this.#emit('stroke', { part: over.part, point: over.point, speed: Math.hypot(p.vx, p.vy), start: p.hit });
      }
    }
  }

  #up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    clearTimeout(p.holdTimer);
    this.pointers.delete(e.pointerId);
    const dur = performance.now() - p.t0;
    const dx = p.x - p.x0, dy = p.y - p.y0;
    if (p.dragging) {
      this.#emit('dragend', { start: p.hit, x: p.x, y: p.y, id: p.id });
      const dist = Math.hypot(dx, dy);
      if (dist > SWIPE_PX && dur < 700 && p.travelled < dist * 1.6) {
        const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        this.#emit('swipe', { dir, start: p.hit });
      }
    } else if (!p.held && dur < TAP_MAX_MS) {
      this.#emit('tap', { hit: p.hit, x: p.x, y: p.y });
    }
    if (p.held) this.#emit('release', { hit: p.hit });
  }

  #cancel(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    clearTimeout(p.holdTimer);
    this.pointers.delete(e.pointerId);
    if (p.dragging) this.#emit('dragend', { start: p.hit, x: p.x, y: p.y, id: p.id, cancelled: true });
  }
}
