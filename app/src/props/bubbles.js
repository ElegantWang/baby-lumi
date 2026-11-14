// Soap bubbles: they drift up, shimmer, and pop when touched. Each bubble has
// a colour, which Lumi names when it pops.
import * as THREE from 'three';

export const BUBBLE_COLORS = [
  { name: 'red', rgb: [1.0, 0.3, 0.32] },
  { name: 'blue', rgb: [0.3, 0.58, 1.0] },
  { name: 'yellow', rgb: [1.0, 0.88, 0.25] },
  { name: 'green', rgb: [0.35, 0.88, 0.42] },
  { name: 'pink', rgb: [1.0, 0.52, 0.78] },
  { name: 'purple', rgb: [0.68, 0.45, 1.0] },
  { name: 'orange', rgb: [1.0, 0.6, 0.2] },
];

const MAX = 14;

const vert = /* glsl */ `
attribute vec3 aTint;
attribute float aWobble;
uniform float uTime;
varying vec3 vN;
varying vec3 vWorldPos;
varying vec3 vTint;
varying vec3 vLocal;
void main() {
  vTint = aTint;
  vLocal = position;
  // bubbles wobble like jelly
  vec3 p = position * (1.0 + 0.05 * sin(uTime * 5.0 + aWobble + position.y * 4.0) + 0.04 * sin(uTime * 3.3 + aWobble * 2.0 + position.x * 5.0));
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const frag = /* glsl */ `
uniform vec3 uSkyColor;
uniform vec3 uKeyColor;
uniform float uTime;
varying vec3 vN;
varying vec3 vWorldPos;
varying vec3 vTint;
varying vec3 vLocal;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.2);
  // thin-film shimmer swirling across the surface
  float swirl = vLocal.y * 3.0 + vLocal.x * 2.0 + uTime * 0.6 + fres * 3.0;
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (swirl * 0.35 + vec3(0.0, 0.33, 0.67)));
  vec3 col = mix(vTint, film, 0.28) * (0.55 + 0.9 * fres) + uSkyColor * fres * 0.6;
  float alpha = mix(0.16, 0.9, fres);
  // window-like highlights
  vec3 Hd = normalize(vec3(-0.45, 0.6, 0.66));
  float hl = smoothstep(0.93, 0.985, dot(N, Hd));
  float hl2 = smoothstep(0.975, 0.995, dot(N, normalize(vec3(0.5, -0.45, 0.74)))) * 0.6;
  col += uKeyColor * (hl + hl2) * 1.6;
  alpha = clamp(alpha + hl + hl2, 0.0, 1.0);
  gl_FragColor = vec4(col * alpha, alpha);
}`;

export class Bubbles {
  constructor(env) {
    const geo = new THREE.SphereGeometry(1, 28, 18);
    this.tint = new Float32Array(MAX * 3);
    this.wobble = new Float32Array(MAX);
    this.aTint = new THREE.InstancedBufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage);
    this.aWobble = new THREE.InstancedBufferAttribute(this.wobble, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTint', this.aTint);
    geo.setAttribute('aWobble', this.aWobble);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSkyColor: env.uniforms.uSkyColor, uKeyColor: env.uniforms.uKeyColor, uTime: env.uniforms.uTime },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: true, // so depth of field keeps bubbles crisp instead of blurring them with the hills
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 55;
    this.mesh.name = 'bubbles';
    this.items = [];
    this.halfWidth = 1.2; // how far left/right of centre is still on screen (set by the app)
    this.onPop = () => {};
    this.onGone = () => {};
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  get count() {
    return this.items.length;
  }

  /** Blow a bubble from `origin`. */
  spawn(origin, { color = null, radius = null, delay = 0 } = {}) {
    if (this.items.length >= MAX) return null;
    const c = color || BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)];
    const b = {
      color: c,
      pos: origin.clone().setX(Math.max(-this.halfWidth, Math.min(this.halfWidth, origin.x))),
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.2 + Math.random() * 0.12, (Math.random() - 0.5) * 0.08),
      radius: radius ?? 0.075 + Math.random() * 0.04,
      age: -delay,
      seed: Math.random() * 20,
      grow: 0,
    };
    this.items.push(b);
    return b;
  }

  /** @returns {{prop: object, t: number} | null} nearest bubble under the ray */
  pick(o, d) {
    let best = null;
    for (const b of this.items) {
      if (b.age < 0) continue;
      const ox = b.pos.x - o.x, oy = b.pos.y - o.y, oz = b.pos.z - o.z;
      const t = ox * d.x + oy * d.y + oz * d.z;
      if (t < 0) continue;
      const dist2 = ox * ox + oy * oy + oz * oz - t * t;
      const r = b.radius * 1.7 + 0.03; // forgiving for little fingers
      if (dist2 < r * r && (!best || t < best.t)) best = { prop: { type: 'bubble', bubble: b }, t };
    }
    return best;
  }

  pop(b) {
    const i = this.items.indexOf(b);
    if (i < 0) return false;
    this.items.splice(i, 1);
    this.onPop(b);
    if (this.items.length === 0) this.onGone('popped');
    return true;
  }

  clear() {
    this.items.length = 0;
  }

  update(dt, time) {
    let n = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const b = this.items[i];
      b.age += dt;
      if (b.age < 0) continue;
      b.grow = Math.min(1, b.grow + dt * 3.5);
      // float up, slow down, sway
      b.vel.y += (0.11 - b.vel.y) * (1 - Math.exp(-dt * 0.9));
      b.vel.x += Math.sin(time * 1.3 + b.seed) * 0.12 * dt;
      b.vel.x *= Math.exp(-dt * 0.5);
      // drift back if it wanders toward the edge of the screen, so it stays poppable
      if (Math.abs(b.pos.x) > this.halfWidth) b.vel.x -= Math.sign(b.pos.x) * dt * 0.9;
      b.pos.addScaledVector(b.vel, dt);
      if (b.pos.y > 2.3 || b.age > 20) {
        this.items.splice(i, 1);
        if (this.items.length === 0) this.onGone('floated');
      }
    }
    for (const b of this.items) {
      if (b.age < 0) continue;
      const s = b.radius * (0.2 + 0.8 * (1 - Math.pow(1 - b.grow, 3)));
      this._s.set(s, s, s);
      this._m.compose(b.pos, this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      this.tint.set(b.color.rgb, n * 3);
      this.wobble[n] = b.seed;
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.aTint.needsUpdate = true;
      this.aWobble.needsUpdate = true;
    }
  }
}
