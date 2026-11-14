// Little floating symbols that show what Lumi feels: hearts, stars, sparkles,
// music notes, sleepy Z's, dust puffs and pop rings. One instanced draw call;
// every shape is a signed-distance function, so they stay crisp at any size.
import * as THREE from 'three';

export const KIND = { heart: 0, star: 1, sparkle: 2, note: 3, zzz: 4, puff: 5, ring: 6, drop: 7 };
const MAX = 120;

const vert = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aParams; // size, rotation, kind, alpha
attribute vec3 aColor;
varying vec2 vUv;
varying float vKind;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vUv = position.xy;
  vKind = aParams.z;
  vAlpha = aParams.w;
  vColor = aColor;
  float c = cos(aParams.y), s = sin(aParams.y);
  vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * aParams.x;
  vec4 mv = viewMatrix * vec4(aPos, 1.0);
  mv.xy += q;
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
varying vec2 vUv;
varying float vKind;
varying float vAlpha;
varying vec3 vColor;

float sdHeart(vec2 p) {
  p.x = abs(p.x);
  p.y += 0.55;
  if (p.y + p.x > 1.0) return sqrt(dot(p - vec2(0.25, 0.75), p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot(p - vec2(0.0, 1.0), p - vec2(0.0, 1.0)), dot(p - 0.5 * max(p.x + p.y, 0.0), p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0, 1);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
void main() {
  vec2 p = vUv;
  float d = 1.0;       // signed distance, < 0 inside
  float soft = 0.0;    // 1 = draw as a soft blob instead of a crisp shape
  int kind = int(vKind + 0.5);
  if (kind == 0) d = sdHeart(p * 1.15 + vec2(0.0, -0.08)) / 1.15;
  else if (kind == 1) d = sdStar5(p, 0.82, 0.48) - 0.06;
  else if (kind == 2) d = pow(abs(p.x), 0.55) + pow(abs(p.y), 0.55) - 0.95;
  else if (kind == 3) {
    vec2 h = p - vec2(-0.22, -0.52);
    float c = cos(0.45), s = sin(0.45);
    h = vec2(c * h.x + s * h.y, -s * h.x + c * h.y);
    float head = length(h / vec2(0.34, 0.25)) - 1.0;
    float stem = sdSeg(p, vec2(0.08, -0.5), vec2(0.08, 0.72)) - 0.055;
    float flag = sdSeg(p, vec2(0.1, 0.72), vec2(0.5, 0.3)) - 0.085;
    d = min(min(head * 0.25, stem), flag);
  } else if (kind == 4) {
    float z = min(min(sdSeg(p, vec2(-0.5, 0.55), vec2(0.5, 0.55)), sdSeg(p, vec2(0.5, 0.55), vec2(-0.5, -0.55))), sdSeg(p, vec2(-0.5, -0.55), vec2(0.5, -0.55)));
    d = z - 0.13;
  } else if (kind == 5) { soft = 1.0; }
  else if (kind == 6) d = abs(length(p) - 0.8) - 0.07;
  else {
    vec2 q = p * vec2(1.25, 1.0);
    float r = length(q - vec2(0.0, -0.25)) - 0.5;
    float tip = sdSeg(q, vec2(0.0, 0.1), vec2(0.0, 0.8)) - 0.34 * (1.0 - smoothstep(0.1, 0.8, q.y));
    d = min(r, tip);
  }
  float alpha;
  vec3 col = vColor;
  if (soft > 0.5) {
    float r = length(p);
    alpha = smoothstep(1.0, 0.1, r) * 0.55;
  } else {
    float aa = fwidth(d) * 1.2 + 0.002;
    alpha = 1.0 - smoothstep(-aa, aa, d);
    // glossy sticker look: lighter toward the upper left, bright rim
    float sheen = smoothstep(0.9, -0.5, p.x - p.y) * 0.35;
    col = mix(col, vec3(1.0), sheen * 0.6);
    col *= 1.0 + 0.55 * smoothstep(-0.16, 0.0, d);
  }
  alpha *= vAlpha;
  if (alpha < 0.03) discard;
  gl_FragColor = vec4(col, alpha);
}`;

const COLORS = {
  heart: [1.0, 0.36, 0.52],
  star: [1.0, 0.82, 0.25],
  sparkle: [1.0, 0.96, 0.75],
  note: [0.62, 0.48, 1.0],
  zzz: [0.62, 0.7, 1.0],
  puff: [0.95, 0.98, 0.9],
  ring: [1.0, 1.0, 1.0],
  drop: [0.6, 0.85, 1.0],
};

export class Emotes {
  constructor() {
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', quad.attributes.position);
    geo.setIndex(quad.index);
    this.pos = new Float32Array(MAX * 3);
    this.params = new Float32Array(MAX * 4);
    this.color = new Float32Array(MAX * 3);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aParams = new THREE.InstancedBufferAttribute(this.params, 4).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aParams', this.aParams);
    geo.setAttribute('aColor', this.aColor);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      // Drawn with alpha-to-coverage and depth writes rather than blending, so
      // the depth-of-field pass sees them as in-focus objects and keeps them sharp.
      alphaToCoverage: true,
      depthWrite: true,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 60;
    this.mesh.name = 'emotes';
    this.items = [];
  }

  /**
   * @param {keyof typeof KIND} kind
   * @param {THREE.Vector3} origin
   * @param {number} count
   * @param {{spread?: number, color?: number[], size?: number, speed?: number}} o
   */
  burst(kind, origin, count = 1, o = {}) {
    for (let i = 0; i < count; i++) {
      if (this.items.length >= MAX) this.items.shift();
      const spread = o.spread ?? 0.12;
      const it = {
        kind: KIND[kind],
        name: kind,
        x: origin.x + (Math.random() - 0.5) * spread,
        y: origin.y + (Math.random() - 0.5) * spread * 0.6,
        z: origin.z + (Math.random() - 0.5) * spread * 0.5,
        vx: 0, vy: 0, vz: 0,
        age: -i * (o.stagger ?? 0.09),
        life: 1.3,
        size: (o.size ?? 0.06) * (0.8 + Math.random() * 0.45),
        rot: (Math.random() - 0.5) * 0.5,
        spin: 0,
        sway: Math.random() * 6.28,
        gravity: 0,
        color: o.color || COLORS[kind],
        grow: 0,
      };
      const sp = o.speed ?? 1;
      if (kind === 'heart') {
        it.vx = (Math.random() - 0.5) * 0.25;
        it.vy = (0.32 + Math.random() * 0.2) * sp;
        it.life = 1.5;
      } else if (kind === 'star' || kind === 'sparkle') {
        const a = Math.random() * Math.PI * 2, s = (0.5 + Math.random() * 0.6) * sp;
        it.vx = Math.cos(a) * s;
        it.vy = Math.abs(Math.sin(a)) * s + 0.25;
        it.vz = (Math.random() - 0.5) * 0.3;
        it.gravity = 1.1;
        it.spin = (Math.random() - 0.5) * 7;
        it.life = kind === 'star' ? 1.0 : 0.75;
        it.size *= kind === 'star' ? 0.85 : 0.7;
      } else if (kind === 'note') {
        it.vx = (Math.random() < 0.5 ? -1 : 1) * (0.1 + Math.random() * 0.1);
        it.vy = 0.24 * sp;
        it.life = 1.9;
        it.size *= 0.9;
      } else if (kind === 'zzz') {
        it.vx = 0.07;
        it.vy = 0.11;
        it.life = 2.8;
        it.grow = 0.7;
        it.size *= 0.85;
        it.rot = -0.2;
      } else if (kind === 'puff') {
        const a = Math.random() * Math.PI * 2;
        it.vx = Math.cos(a) * 0.45;
        it.vz = Math.sin(a) * 0.3;
        it.vy = 0.12;
        it.life = 0.55;
        it.grow = 2.2;
        it.size *= 1.3;
      } else if (kind === 'ring') {
        it.life = 0.34;
        it.grow = 2.4;
        it.size *= 0.9;
        it.rot = 0;
      } else if (kind === 'drop') {
        it.vy = 0.1;
        it.gravity = 1.6;
        it.life = 0.8;
        it.size *= 0.5;
        it.rot = 0;
      }
      this.items.push(it);
    }
  }

  update(dt) {
    let n = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      if (it.age >= it.life) this.items.splice(i, 1);
    }
    for (const it of this.items) {
      if (it.age < 0) continue;
      it.vy -= it.gravity * dt;
      const drag = Math.exp(-dt * (it.kind === KIND.puff ? 4 : 1.2));
      it.vx *= drag;
      it.vz *= drag;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.z += it.vz * dt;
      it.rot += it.spin * dt;
      const u = it.age / it.life;
      let x = it.x;
      if (it.kind === KIND.heart || it.kind === KIND.note) x += Math.sin(it.age * 3.2 + it.sway) * 0.03;
      // pop in with a little overshoot, fade out at the end
      const pop = u < 0.14 ? 1 + 2.3 * Math.pow(u / 0.14 - 1, 3) + 1.3 * Math.pow(u / 0.14 - 1, 2) : 1;
      const fade = it.kind === KIND.puff || it.kind === KIND.ring ? 1 - u : Math.min(1, (1 - u) / 0.3);
      const size = it.size * pop * (1 + it.grow * u);
      this.pos.set([x, it.y, it.z], n * 3);
      this.params.set([size, it.rot, it.kind, Math.max(0, fade)], n * 4);
      this.color.set([it.color[0] * 1.35, it.color[1] * 1.35, it.color[2] * 1.35], n * 3);
      n++;
    }
    this.mesh.geometry.instanceCount = n;
    if (n > 0) {
      this.aPos.needsUpdate = true;
      this.aParams.needsUpdate = true;
      this.aColor.needsUpdate = true;
    }
    this.mesh.visible = n > 0;
  }
}
