// Drives Lumi's whole performance each frame by layering:
//   1. procedural idle (breathing, sway, tail wag, ear twitches)
//   2. the current stance (stand / sit / asleep ...) and facial expression
//   3. one-shot action clips (wave, jump, giggle ...)
//   4. look-at, lip-sync and blinking
//   5. springy secondary motion for ears and tail
import * as THREE from 'three';
import { Channels, expandChannel, FACE_DEFAULTS } from './channels.js';
import { EASE, clamp, lerp, damp, smoothstep } from './easing.js';
import { Jiggle } from './jiggle.js';
import { buildLibrary } from './clips.js';

const _v = new THREE.Vector3();

function compileClip(name, def, ch) {
  const tracks = [];
  let dur = def.dur || 0;
  for (const [pattern, keys] of Object.entries(def.tracks || {})) {
    for (const { name: chName, sign } of expandChannel(pattern)) {
      const index = ch.index[chName];
      if (index === undefined) throw new Error(`clip "${name}": unknown channel "${chName}"`);
      for (let i = 1; i < keys.length; i++) {
        if (keys[i][0] < keys[i - 1][0]) throw new Error(`clip "${name}": keys out of order on "${pattern}"`);
      }
      tracks.push({
        index,
        sign,
        times: keys.map((k) => k[0]),
        values: keys.map((k) => k[1]),
        eases: keys.map((k) => {
          const e = EASE[k[2] || 'inOut'];
          if (!e) throw new Error(`clip "${name}": unknown ease "${k[2]}"`);
          return e;
        }),
      });
      dur = Math.max(dur, keys[keys.length - 1][0]);
    }
  }
  return {
    name,
    dur,
    loop: !!def.loop,
    additive: !!def.additive,
    fadeIn: def.fadeIn ?? 0.16,
    fadeOut: def.fadeOut ?? 0.3,
    look: def.look ?? 0.5,
    blink: def.blink ?? true,
    idle: def.idle ?? 0.35, // how much procedural idle remains underneath
    events: (def.events || []).slice().sort((a, b) => a[0] - b[0]),
    tracks,
  };
}

function sampleTrack(tr, t) {
  const times = tr.times, n = times.length;
  if (t <= times[0]) return tr.values[0] * tr.sign;
  if (t >= times[n - 1]) return tr.values[n - 1] * tr.sign;
  let i = 0;
  while (i < n - 2 && times[i + 1] <= t) i++;
  const u = (t - times[i]) / (times[i + 1] - times[i]);
  return lerp(tr.values[i], tr.values[i + 1], tr.eases[i + 1](u)) * tr.sign;
}

function compilePose(name, def, ch) {
  const out = [];
  for (const [pattern, value] of Object.entries(def)) {
    for (const { name: chName, sign } of expandChannel(pattern)) {
      const index = ch.index[chName];
      if (index === undefined) throw new Error(`pose "${name}": unknown channel "${chName}"`);
      out.push([index, value * sign]);
    }
  }
  return out;
}

export class Animator {
  /** @param {import('../character/lumi.js').Lumi} lumi */
  constructor(lumi) {
    this.lumi = lumi;
    this.ch = new Channels(lumi);
    this.jiggle = new Jiggle(lumi);
    const { CLIPS, STANCES, EXPRESSIONS } = buildLibrary(lumi.header);
    this.clips = {};
    for (const [name, def] of Object.entries(CLIPS)) this.clips[name] = compileClip(name, def, this.ch);
    this.stances = {};
    for (const [name, def] of Object.entries(STANCES)) this.stances[name] = { pose: compilePose(name, def, this.ch), weight: name === 'stand' ? 1 : 0 };
    this.stance = 'stand';
    this.expressions = {};
    for (const [name, def] of Object.entries(EXPRESSIONS)) this.expressions[name] = def;

    this.active = [];
    this.time = 0;
    this.onEvent = () => {};

    // face expression state: damped toward the current preset
    this.faceKeys = Object.keys(FACE_DEFAULTS);
    this.exprNow = { ...FACE_DEFAULTS };
    this.expression = 'neutral';
    this.baseExpression = 'neutral';
    this.exprHold = 0;

    this.cameraPos = new THREE.Vector3(0, 1, 4.5);
    this.lookTarget = null;
    this.lookHold = 0;
    this.lookAmount = 1;
    this.look = { headYaw: 0, headPitch: 0, gazeX: 0, gazeY: 0, saccadeX: 0, saccadeY: 0, nextSaccade: 1 };

    this.speech = { level: 0, wide: 0, open: 0, bob: 0 };
    this.blink = { next: 2, t: -1, double: false };
    this.twitch = { next: 3, t: -1, side: 'L', amp: 0 };

    this.energy = 1; // scales idle motion (0 = statue, 1 = lively)
    this.wag = 0.5; // tail wag intensity
    this.breathRate = 1;
    this.eyesShut = false; // true while asleep: no blinking, no looking
    this.mouthBias = 0; // 0..1 extra mouth opening (anticipating a snack)
    this.starBoost = 0; // 0..1 extra glow on the forehead star
    this.freeze = null; // debug: { clip, t }
    this.idleSeed = Math.random() * 100;
  }

  // ---- control ---------------------------------------------------------------

  /**
   * Start a clip. By default it replaces whatever action is playing.
   * @param {string} name
   * @param {{speed?: number, layer?: boolean, onDone?: () => void}} opts
   */
  play(name, opts = {}) {
    const clip = this.clips[name];
    if (!clip) throw new Error(`no clip named "${name}"`);
    if (!opts.layer) for (const a of this.active) if (!a.layer) a.state = 'out';
    const inst = {
      clip, t: 0, speed: opts.speed ?? 1, weight: 0, state: 'in', layer: !!opts.layer,
      onDone: opts.onDone || null, lastT: -1e-6, done: false,
    };
    this.active.push(inst);
    return inst;
  }

  stop(inst) {
    if (inst && inst.state !== 'out') inst.state = 'out';
  }

  stopAll() {
    for (const a of this.active) a.state = 'out';
  }

  /** Is a (non-overlay) action clip currently playing? */
  get busy() {
    return this.active.some((a) => !a.layer && a.state !== 'out');
  }

  isPlaying(name) {
    return this.active.some((a) => a.clip.name === name && a.state !== 'out');
  }

  setStance(name) {
    if (!this.stances[name]) throw new Error(`no stance "${name}"`);
    this.stance = name;
  }

  /** Show an expression for `hold` seconds, then drift back to the base mood. */
  setExpression(name, hold = 2) {
    if (!this.expressions[name]) throw new Error(`no expression "${name}"`);
    this.expression = name;
    this.exprHold = hold;
  }

  setBaseExpression(name) {
    if (!this.expressions[name]) throw new Error(`no expression "${name}"`);
    this.baseExpression = name;
    if (this.exprHold <= 0) this.expression = name;
  }

  /** Look at a world point for a while (null = look at the child / camera). */
  lookAt(point, hold = 2) {
    this.lookTarget = point ? point.clone() : null;
    this.lookHold = hold;
  }

  // ---- per-frame ---------------------------------------------------------------

  update(dt) {
    this.time += dt;
    const ch = this.ch, v = ch.values, ix = ch.index;
    ch.reset();

    if (this.freeze) {
      this.#applyStances(0, true);
      this.#applyExpression(0, true);
      const clip = this.clips[this.freeze.clip];
      if (clip) for (const tr of clip.tracks) v[tr.index] = clip.additive ? v[tr.index] + sampleTrack(tr, this.freeze.t) : sampleTrack(tr, this.freeze.t);
      ch.apply();
      this.lumi.bones.root.updateMatrixWorld(true);
      this.lumi.applyFace();
      return;
    }

    // how much of the idle layer should show through the current action
    let idleKeep = 1, lookKeep = 1, canBlink = true;
    for (const a of this.active) {
      const w = smoothstep(0, 1, a.weight);
      if (!a.clip.additive) idleKeep = Math.min(idleKeep, lerp(1, a.clip.idle, w));
      lookKeep = Math.min(lookKeep, lerp(1, a.clip.look, w));
      if (!a.clip.blink && w > 0.5) canBlink = false;
    }

    this.#applyExpression(dt, false);
    this.#applyIdle(dt, idleKeep);
    this.#applyStances(dt, false);
    this.#applyClips(dt);
    this.#applyLook(dt, lookKeep);
    this.#applySpeech(dt);
    this.#applyBlink(dt, canBlink);
    if (this.mouthBias > 0) v[ix.mouthOpen] = Math.max(v[ix.mouthOpen], this.mouthBias * 0.85);
    if (this.starBoost > 0) v[ix.star] = Math.max(v[ix.star], this.starBoost);

    ch.apply();
    this.lumi.bones.root.updateMatrixWorld(true);
    this.jiggle.update(dt);
    this.lumi.bones.root.updateMatrixWorld(true);
    this.lumi.applyFace();
  }

  #applyExpression(dt, snap) {
    if (this.exprHold > 0) {
      this.exprHold -= dt;
      if (this.exprHold <= 0) this.expression = this.baseExpression;
    }
    const preset = this.expressions[this.expression] || {};
    const ch = this.ch;
    for (let i = 0; i < this.faceKeys.length; i++) {
      const k = this.faceKeys[i];
      const goal = k in preset ? preset[k] : FACE_DEFAULTS[k];
      this.exprNow[k] = snap ? goal : damp(this.exprNow[k], goal, 9, dt);
      ch.values[ch.faceBase + i] = this.exprNow[k];
    }
  }

  #applyIdle(dt, keep) {
    const v = this.ch.values, ix = this.ch.index;
    const t = this.time + this.idleSeed;
    const e = this.energy * keep;
    // breathing
    const br = Math.sin(this.time * 1.75 * this.breathRate);
    v[ix.breath] += 0.5 + 0.5 * br;
    v[ix['chest.rx']] += -1.1 * br * Math.max(e, 0.4);
    v[ix['head.py']] += 0.004 * br;
    v[ix['armL1.rz']] += 1.6 * br * e;
    v[ix['armR1.rz']] -= 1.6 * br * e;
    // gentle weight shifting
    v[ix['hips.rz']] += 1.3 * Math.sin(t * 0.61) * e;
    v[ix['chest.rz']] += -0.8 * Math.sin(t * 0.61 + 0.4) * e;
    v[ix['hips.ry']] += 1.6 * Math.sin(t * 0.37 + 1.7) * e;
    v[ix['head.rz']] += (1.8 * Math.sin(t * 0.47 + 0.9) + 0.9 * Math.sin(t * 1.13)) * e;
    v[ix['head.rx']] += 1.2 * Math.sin(t * 0.53 + 2.1) * e;
    // tail: a travelling wave from base to tip
    const wag = this.wag * Math.max(e, 0.15);
    const ws = 1.6 + 2.6 * this.wag;
    v[ix['tail1.ry']] += 9 * wag * Math.sin(t * ws);
    v[ix['tail2.ry']] += 13 * wag * Math.sin(t * ws - 0.7);
    v[ix['tail3.ry']] += 15 * wag * Math.sin(t * ws - 1.4);
    v[ix['tail4.ry']] += 16 * wag * Math.sin(t * ws - 2.1);
    v[ix['tail2.rx']] += 3 * Math.sin(t * 0.8) * e;
    // ears breathe and occasionally flick
    v[ix['earL1.rz']] += 1.5 * Math.sin(t * 0.71) * e;
    v[ix['earR1.rz']] += 1.5 * Math.sin(t * 0.67 + 1.0) * e;
    const tw = this.twitch;
    if (this.energy > 0.3) {
      tw.next -= dt;
      if (tw.next <= 0) {
        tw.next = 2.5 + Math.random() * 6;
        tw.t = 0;
        tw.side = Math.random() < 0.5 ? 'L' : 'R';
        tw.amp = 10 + Math.random() * 12;
      }
    }
    if (tw.t >= 0) {
      tw.t += dt;
      const k = Math.exp(-tw.t * 7) * Math.sin(tw.t * 34) * tw.amp * keep;
      const sgn = tw.side === 'L' ? -1 : 1;
      v[ix[`ear${tw.side}1.rz`]] += k * sgn;
      v[ix[`ear${tw.side}2.rz`]] += k * sgn * 1.3;
      if (tw.t > 0.8) tw.t = -1;
    }
  }

  #applyStances(dt, snap) {
    const v = this.ch.values;
    for (const [name, s] of Object.entries(this.stances)) {
      const goal = name === this.stance ? 1 : 0;
      s.weight = snap ? goal : damp(s.weight, goal, 5.5, dt);
      if (s.weight < 0.001) continue;
      const w = smoothstep(0, 1, s.weight);
      for (const [i, val] of s.pose) v[i] += val * w;
    }
  }

  #applyClips(dt) {
    const v = this.ch.values;
    for (let n = 0; n < this.active.length; n++) {
      const a = this.active[n];
      const clip = a.clip;
      a.t += dt * a.speed;
      // events
      for (const ev of clip.events) {
        if (ev[0] > a.lastT && ev[0] <= a.t && a.state !== 'out') this.onEvent(ev[1], ev.slice(2), a);
      }
      a.lastT = a.t;
      if (a.t >= clip.dur) {
        if (clip.loop && a.state !== 'out') {
          a.t -= clip.dur;
          a.lastT = -1e-6;
        } else {
          a.t = clip.dur;
          if (a.state !== 'out') a.state = 'out';
          if (!a.done) {
            a.done = true;
            a.onDone?.();
          }
        }
      }
      if (a.state === 'in') {
        a.weight += dt / Math.max(clip.fadeIn, 1e-3);
        if (a.weight >= 1) {
          a.weight = 1;
          a.state = 'play';
        }
      } else if (a.state === 'out') {
        a.weight -= dt / Math.max(clip.fadeOut, 1e-3);
      }
      if (a.weight <= 0) continue;
      const w = smoothstep(0, 1, a.weight);
      for (const tr of clip.tracks) {
        const s = sampleTrack(tr, a.t);
        v[tr.index] = clip.additive ? v[tr.index] + s * w : lerp(v[tr.index], s, w);
      }
    }
    for (let n = this.active.length - 1; n >= 0; n--) {
      const a = this.active[n];
      if (a.state === 'out' && a.weight <= 0) {
        if (!a.done) {
          a.done = true;
          a.onDone?.();
        }
        this.active.splice(n, 1);
      }
    }
  }

  #applyLook(dt, keep) {
    const v = this.ch.values, ix = this.ch.index, L = this.look;
    if (this.lookHold > 0) {
      this.lookHold -= dt;
      if (this.lookHold <= 0) this.lookTarget = null;
    }
    const amount = (this.eyesShut ? 0 : this.lookAmount) * keep;
    const head = this.lumi.bones.head;
    _v.setFromMatrixPosition(head.matrixWorld);
    _v.y += 0.2;
    const tgt = this.lookTarget || this.cameraPos;
    let dx = tgt.x - _v.x;
    const dy = tgt.y - _v.y;
    let dz = tgt.z - _v.z;
    // into Lumi's own frame (she may have turned)
    const yawRoot = (v[ix['root.ry']] + v[ix['hips.ry']]) * (Math.PI / 180);
    const c = Math.cos(-yawRoot), s = Math.sin(-yawRoot);
    const lx = dx * c + dz * s, lz = -dx * s + dz * c;
    dx = lx;
    dz = lz;
    const yaw = clamp((Math.atan2(dx, dz) * 180) / Math.PI, -75, 75);
    const pitch = clamp((-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI, -40, 40);
    L.headYaw = damp(L.headYaw, clamp(yaw * 0.55, -36, 36) * amount, 6, dt);
    L.headPitch = damp(L.headPitch, clamp(pitch * 0.5, -18, 20) * amount, 6, dt);
    // eyes cover the rest of the angle, quickly, with tiny darting saccades
    L.nextSaccade -= dt;
    if (L.nextSaccade <= 0) {
      L.nextSaccade = 0.8 + Math.random() * 2.6;
      L.saccadeX = (Math.random() - 0.5) * 0.22;
      L.saccadeY = (Math.random() - 0.5) * 0.14;
    }
    const gx = clamp((yaw - L.headYaw) / 30 + L.saccadeX, -1, 1) * amount;
    const gy = clamp(-(pitch - L.headPitch) / 26 + L.saccadeY, -1, 1) * amount;
    L.gazeX = damp(L.gazeX, gx, 18, dt);
    L.gazeY = damp(L.gazeY, gy, 18, dt);
    v[ix['head.ry']] += L.headYaw * 0.78;
    v[ix['chest.ry']] += L.headYaw * 0.22;
    v[ix['head.rx']] += L.headPitch;
    v[ix['head.rz']] += L.headYaw * -0.1;
    v[ix.gazeX] = clamp(v[ix.gazeX] + L.gazeX, -1, 1);
    v[ix.gazeY] = clamp(v[ix.gazeY] + L.gazeY, -1, 1);
  }

  #applySpeech(dt) {
    const v = this.ch.values, ix = this.ch.index, S = this.speech;
    const target = clamp(S.level, 0, 1);
    // open fast, close a little slower: reads as syllables
    S.open = damp(S.open, target, target > S.open ? 38 : 16, dt);
    if (S.open < 0.004) return;
    v[ix.mouthOpen] = Math.max(v[ix.mouthOpen], S.open * 0.95);
    v[ix.mouthWide] = lerp(v[ix.mouthWide], S.wide, Math.min(1, S.open * 3));
    v[ix['jaw.rx']] += S.open * 9;
    // a little bounce of the head with each syllable
    v[ix['head.rx']] += -S.open * 3.2;
    v[ix['earL1.rx']] += S.open * 3;
    v[ix['earR1.rx']] += S.open * 3;
  }

  #applyBlink(dt, canBlink) {
    const v = this.ch.values, ix = this.ch.index, B = this.blink;
    if (this.eyesShut) return;
    if (B.t < 0) {
      B.next -= dt;
      if (B.next <= 0 && canBlink) {
        B.t = 0;
        B.double = Math.random() < 0.18;
      }
    }
    if (B.t >= 0) {
      B.t += dt;
      const t = B.t;
      // close in 60 ms, hold 30 ms, open in 110 ms
      let k = t < 0.06 ? t / 0.06 : t < 0.09 ? 1 : 1 - (t - 0.09) / 0.11;
      if (t >= 0.2) {
        k = 0;
        if (B.double) {
          B.double = false;
          B.t = 0; // and straight into a second blink
        } else {
          B.t = -1;
          B.next = 1.8 + Math.random() * 4.2;
        }
      }
      k = clamp(k);
      v[ix.lidUpperL] = Math.max(v[ix.lidUpperL], k);
      v[ix.lidUpperR] = Math.max(v[ix.lidUpperR], k);
    }
  }

  /** Debug: hold one clip at a fixed time (no idle, no physics). */
  debugPose(clip, t) {
    this.freeze = clip ? { clip, t } : null;
    this.jiggle.reset();
  }
}
