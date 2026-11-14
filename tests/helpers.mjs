// Shared test fixtures: the real character asset and animation code, with
// lightweight stand-ins for sound and the screen.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { buildSkeleton } from '../app/src/character/loader.js';
import { FACE_DEFAULTS } from '../app/src/anim/channels.js';
import { Animator } from '../app/src/anim/animator.js';
import { Atmosphere } from '../app/src/world/atmosphere.js';
import { Snack } from '../app/src/props/food.js';
import { Bubbles } from '../app/src/props/bubbles.js';
import { Butterfly } from '../app/src/props/butterfly.js';
import { Blooms } from '../app/src/props/blooms.js';
import { Brain } from '../app/src/brain/brain.js';
import { Store } from '../app/src/brain/store.js';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Deterministic Math.random for repeatable behaviour tests. */
export function seedRandom(seed = 1) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadAsset() {
  const file = readFileSync(ROOT + 'app/assets/lumi.bin');
  const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const dv = new DataView(buf);
  const headerLen = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headerLen)));
  const base = 8 + headerLen;
  const TYPES = { f32: Float32Array, i8: Int8Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array };
  const attributes = {};
  for (const a of header.attributes) attributes[a.name] = new TYPES[a.type](buf, base + a.offset, a.count * a.itemSize);
  const index = new TYPES[header.index.type](buf, base + header.index.offset, header.index.count);
  return { magic: dv.getUint32(0, true), header, attributes, index };
}

export function fakeLumi() {
  const { header } = loadAsset();
  const rig = buildSkeleton(header);
  const group = new THREE.Group();
  group.add(rig.root);
  return {
    header,
    bones: rig.byName,
    boneList: rig.bones,
    face: { ...FACE_DEFAULTS },
    uniforms: { uFurSway: { value: new THREE.Vector3() } },
    applyFace() {},
    anchorWorld(name, out = new THREE.Vector3()) {
      const a = header.anchors[name];
      const bone = rig.byName[a.bone];
      return out.set(...a.p).sub(bone.userData.rest).applyMatrix4(bone.matrixWorld);
    },
  };
}

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
}
export const memoryStorage = () => new MemoryStorage();

/** A complete brain wired to real animation and props, with silent fake audio. */
export function makeWorld({ hour = 13 } = {}) {
  const lumi = fakeLumi();
  const anim = new Animator(lumi);
  const env = new Atmosphere();
  env.setHour(hour);
  const said = [];
  const sounds = [];
  const audio = {
    unlocked: true, ready: true, speaking: false,
    ctx: { state: 'running', sampleRate: 44100, currentTime: 0, createBuffer: (ch, len, rate) => ({ length: len, duration: len / rate, copyToChannel() {} }) },
    unlock: async () => true, markVoice() {}, playBuffer: () => ({ duration: 1, stop() {} }),
  };
  const vocal = new Proxy({}, { get: (_, name) => (...args) => { sounds.push('vocal:' + String(name)); return name === 'sing' ? 2 : 0.5; } });
  const sfx = { play: (name) => sounds.push('sfx:' + name) };
  const voice = { say: (group) => { said.push(group); return { id: group, duration: 0.8 }; } };
  const emotes = { burst() {} };
  const snack = new Snack(env), bubbles = new Bubbles(env), butterfly = new Butterfly(env), blooms = new Blooms(env);
  const mimic = { paused: false, state: 'listening' };
  const store = new Store(memoryStorage());
  const rig = { zoomGoal: 1, followGoal: new THREE.Vector3() };
  let now = new Date(2026, 5, 1, hour, 0, 0);
  const brain = new Brain({ lumi, anim, rig, env, audio, vocal, sfx, voice, emotes, snack, bubbles, butterfly, blooms, mimic, store, clock: () => now });
  const mouth = new THREE.Vector3(), nose = new THREE.Vector3();
  let time = 0;
  /** Advance the simulation like the app's main loop does. */
  const run = (seconds, dt = 1 / 30) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      time += dt;
      brain.update(dt);
      lumi.anchorWorld('nose', nose);
      lumi.anchorWorld('mouth', mouth);
      snack.update(dt, time, mouth);
      bubbles.update(dt, time);
      butterfly.update(dt, time, nose, brain.mode === 'awake' && !brain.script && !anim.busy);
      blooms.update(dt);
      anim.update(dt);
    }
  };
  const tapPart = (part) => brain.onTap({ kind: 'lumi', part, point: new THREE.Vector3() });
  return { lumi, anim, env, brain, said, sounds, snack, bubbles, butterfly, blooms, mimic, store, rig, audio, run, tapPart };
}
