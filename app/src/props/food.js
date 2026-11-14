// Snacks Lumi can be fed: an apple, a strawberry, a carrot, a cookie.
// A snack pops up beside her; tap it (or drag it to her mouth) to feed her.
import * as THREE from 'three';
import { createToyMaterial, tinted, mergeTinted, lathe } from './toy.js';

const mix = (a, b, t) => a + (b - a) * t;

function buildApple() {
  const body = tinted(
    lathe([[0, 0.058], [0.022, 0.074], [0.052, 0.08], [0.076, 0.062], [0.088, 0.02], [0.082, -0.03], [0.062, -0.066], [0.032, -0.082], [0, -0.076]]),
    (c, x, y, z) => {
      // red with a sun-kissed golden patch
      const t = Math.max(0, Math.min(1, x * 6 + y * 4 + 0.15)) * 0.75;
      c.setRGB(mix(0.93, 1.0, t), mix(0.13, 0.78, t), mix(0.16, 0.24, t));
    },
  );
  const stem = tinted(new THREE.CylinderGeometry(0.006, 0.008, 0.05, 6).rotateZ(-0.25).translate(0.006, 0.088, 0), 0x6b4226);
  const leaf = tinted(new THREE.SphereGeometry(1, 12, 8).scale(0.036, 0.006, 0.019).rotateZ(0.5).translate(0.04, 0.104, 0), 0x58b040);
  return mergeTinted([body, stem, leaf]);
}

function buildStrawberry() {
  const body = tinted(
    lathe([[0, 0.066], [0.036, 0.072], [0.064, 0.054], [0.072, 0.02], [0.058, -0.03], [0.032, -0.07], [0.01, -0.09], [0, -0.092]]),
    (c, x, y, z) => {
      // tiny golden seeds
      const seed = Math.sin(x * 190) * Math.sin(y * 150 + 1.3) * Math.sin(z * 190 + 0.7);
      if (seed > 0.42) c.setRGB(1.0, 0.86, 0.35);
      else c.setRGB(0.95, 0.1 + (y + 0.09) * 0.4, 0.2);
    },
  );
  const parts = [body];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(tinted(new THREE.ConeGeometry(0.019, 0.05, 5).rotateZ(Math.PI / 2 + 0.35).translate(0.03, 0.074, 0).rotateY(a), 0x49a83a));
  }
  parts.push(tinted(new THREE.CylinderGeometry(0.006, 0.006, 0.03, 6).translate(0, 0.09, 0), 0x3f8f32));
  return mergeTinted(parts);
}

function buildCarrot() {
  const body = tinted(
    lathe([[0, 0.108], [0.03, 0.104], [0.041, 0.08], [0.036, 0.0], [0.022, -0.08], [0.007, -0.122], [0, -0.127]]),
    (c, x, y) => {
      const ring = Math.sin(y * 120) > 0.92 ? 0.85 : 1;
      c.setRGB(1.0 * ring, 0.5 * ring, 0.1);
    },
  );
  const parts = [body];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    parts.push(tinted(new THREE.ConeGeometry(0.014, 0.085, 6).translate(0, 0.045, 0).rotateZ(0.42).rotateY(a).translate(0, 0.104, 0), i % 2 ? 0x4cae3c : 0x3d9a32));
  }
  return mergeTinted(parts).rotateZ(0.5);
}

function buildCookie() {
  const body = tinted(lathe([[0, 0.016], [0.072, 0.016], [0.088, 0.007], [0.088, -0.007], [0.072, -0.016], [0, -0.016]], 30), (c, x, y, z) => {
    const speck = Math.sin(x * 130 + z * 70) * Math.sin(z * 150 - x * 40) > 0.6 ? 0.9 : 1;
    c.setRGB(0.86 * speck, 0.63 * speck, 0.36 * speck);
  });
  const parts = [body];
  const chips = [[0, 0], [0.045, 0.012], [-0.04, 0.025], [0.012, -0.046], [-0.03, -0.035], [0.05, -0.03], [-0.008, 0.05]];
  for (const [x, z] of chips) parts.push(tinted(new THREE.SphereGeometry(0.0135, 10, 6).scale(1, 0.75, 1).translate(x, 0.017, z), 0x4b2812));
  return mergeTinted(parts).rotateX(1.15);
}

const BUILDERS = { apple: buildApple, strawberry: buildStrawberry, carrot: buildCarrot, cookie: buildCookie };
export const FOODS = Object.keys(BUILDERS);

export class Snack {
  /** @param env world atmosphere (for lighting) */
  constructor(env) {
    this.material = createToyMaterial(env, 0.55);
    this.geos = {};
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.castShadow = true;
    this.mesh.visible = false;
    this.mesh.name = 'snack';
    this.kind = null;
    this.state = 'none'; // none | waiting | dragged | flying | eaten
    this.home = new THREE.Vector3(-0.46, 0.5, 0.42);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.t = 0;
    this.scale = 0;
    this.bites = 0;
    this.radius = 0.2; // generous touch radius
  }

  spawn(kind) {
    this.kind = kind;
    if (!this.geos[kind]) this.geos[kind] = BUILDERS[kind]().scale(1.45, 1.45, 1.45);
    this.mesh.geometry = this.geos[kind];
    this.state = 'waiting';
    this.t = 0;
    this.scale = 0;
    this.bites = 0;
    this.home.x = Math.random() < 0.5 ? -0.46 : 0.46;
    this.pos.copy(this.home).add(new THREE.Vector3(0, -0.25, 0));
    this.vel.set(0, 0, 0);
    this.mesh.visible = true;
  }

  get active() {
    return this.state !== 'none';
  }

  /** @returns {{prop: Snack, t: number} | null} */
  pick(o, d) {
    if (this.state !== 'waiting') return null;
    const oc = this.pos.clone().sub(o);
    const t = oc.dot(d);
    if (t < 0) return null;
    const dist2 = oc.lengthSq() - t * t;
    return dist2 < this.radius * this.radius ? { prop: this, t } : null;
  }

  /** Send the snack to Lumi's mouth. */
  flyTo(target) {
    if (this.state === 'flying' || this.state === 'eaten') return;
    this.state = 'flying';
    this.t = 0;
    this.from = this.pos.clone();
    this.target.copy(target);
  }

  bite() {
    this.bites++;
    this.state = 'eaten';
    this.t = 0;
  }

  dismiss() {
    if (this.state === 'none') return;
    this.state = 'eaten';
    this.t = 0;
  }

  update(dt, time, mouth) {
    if (this.state === 'none') return;
    this.t += dt;
    const m = this.mesh;
    if (this.state === 'waiting') {
      // pop in, then bob gently and turn
      this.scale += (1 - this.scale) * (1 - Math.exp(-dt * 9));
      const pop = this.t < 0.35 ? 1 + 0.35 * Math.sin((this.t / 0.35) * Math.PI) : 1;
      this.target.copy(this.home);
      this.target.y += Math.sin(time * 2.1) * 0.025;
      this.pos.lerp(this.target, 1 - Math.exp(-dt * 6));
      m.scale.setScalar(this.scale * pop);
      m.rotation.y += dt * 0.9;
      m.rotation.z = Math.sin(time * 1.3) * 0.12;
    } else if (this.state === 'dragged') {
      this.scale += (1.15 - this.scale) * (1 - Math.exp(-dt * 10));
      m.scale.setScalar(this.scale);
      m.rotation.y += dt * 2;
    } else if (this.state === 'flying') {
      const u = Math.min(1, this.t / 0.42);
      const e = u * u * (3 - 2 * u);
      if (mouth) this.target.copy(mouth);
      this.pos.lerpVectors(this.from, this.target, e);
      this.pos.y += Math.sin(u * Math.PI) * 0.12;
      m.scale.setScalar(this.scale * (1 - 0.35 * e));
      m.rotation.y += dt * 6;
    } else if (this.state === 'eaten') {
      const u = Math.min(1, this.t / 0.16);
      if (mouth) this.pos.lerp(mouth, 0.5);
      m.scale.setScalar(this.scale * 0.65 * (1 - u));
      if (u >= 1) {
        this.state = 'none';
        m.visible = false;
      }
    }
    m.position.copy(this.pos);
  }
}
