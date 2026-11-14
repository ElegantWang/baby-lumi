// A butterfly that flutters in, dances around Lumi, and may land on her nose.
import * as THREE from 'three';

const vert = /* glsl */ `
attribute float aSide;
uniform float uFlap;
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  // wings hinge along the body (local Z axis)
  float ang = uFlap * aSide;
  float c = cos(ang), s = sin(ang);
  vec3 p = vec3(position.x * c - position.y * s, position.x * s + position.y * c, position.z);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const frag = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uKeyColor;
uniform vec3 uSkyColor;
varying vec2 vUv;
void main() {
  // vUv.x: 0 at the body .. 1 at the wing tip; vUv.y: -1 back .. 1 front
  vec2 p = vec2(vUv.x, vUv.y);
  if (p.x < 0.0) {
    // the body: a little dark capsule
    float b = length(vec2((p.x + 0.75) * 4.0, p.y * 1.15));
    if (b > 1.0) discard;
    gl_FragColor = vec4(vec3(0.16, 0.1, 0.14), 1.0);
    return;
  }
  // two lobes: a big fore-wing and a smaller hind-wing
  float fore = length((p - vec2(0.46, 0.34)) / vec2(0.5, 0.42));
  float hind = length((p - vec2(0.36, -0.42)) / vec2(0.38, 0.36));
  float d = min(fore, hind);
  if (d > 1.0) discard;
  vec3 col = mix(uColorA, uColorB, smoothstep(0.25, 0.95, d));
  // dark edge and a pale spot on each lobe
  col = mix(col, vec3(0.2, 0.1, 0.22), smoothstep(0.82, 1.0, d));
  float spots = smoothstep(0.2, 0.1, length(p - vec2(0.56, 0.4))) + smoothstep(0.14, 0.07, length(p - vec2(0.42, -0.46)));
  col = mix(col, vec3(1.0, 0.98, 0.9), spots * 0.9);
  gl_FragColor = vec4(col * (uKeyColor * 0.65 + uSkyColor * 0.8), 1.0);
}`;

const PALETTES = [
  [0xffb23e, 0xff6a3d],
  [0x8fd3ff, 0x4f7bff],
  [0xffa8d8, 0xc86bff],
  [0xfff27a, 0xffb347],
];

export class Butterfly {
  constructor(env) {
    // two wing quads (side = +1 / -1) plus a thin body strip (uv.x < 0)
    const pos = [], uv = [], side = [], idx = [];
    const quad = (x0, x1, s, u0, u1) => {
      const b = pos.length / 3;
      pos.push(x0, 0, -1, x1, 0, -1, x1, 0, 1, x0, 0, 1);
      uv.push(u0, -1, u1, -1, u1, 1, u0, 1);
      side.push(s, s, s, s);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    quad(0, 1, 1, 0, 1);
    quad(0, -1, -1, 0, 1);
    quad(-0.09, 0.09, 0, -1, -0.5);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    geo.setIndex(idx);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uFlap: { value: 0 },
        uColorA: { value: new THREE.Color() },
        uColorB: { value: new THREE.Color() },
        uKeyColor: env.uniforms.uKeyColor,
        uSkyColor: env.uniforms.uSkyColor,
      },
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.setScalar(0.075);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'butterfly';
    this.state = 'none'; // none | enter | wander | land | perch | leave
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.goal = new THREE.Vector3();
    this.t = 0;
    this.seed = 0;
    this.onLanded = () => {};
    this.onGone = () => {};
  }

  get active() {
    return this.state !== 'none';
  }

  spawn(from = null) {
    const [a, b] = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    this.material.uniforms.uColorA.value.set(a);
    this.material.uniforms.uColorB.value.set(b);
    const sideSign = Math.random() < 0.5 ? -1 : 1;
    if (from) this.pos.copy(from);
    else this.pos.set(sideSign * 2.2, 1.3 + Math.random() * 0.4, 0.4);
    this.vel.set(-sideSign * 0.6, 0, 0);
    this.state = 'enter';
    this.t = 0;
    this.seed = Math.random() * 50;
    this.wantsToLand = Math.random() < 0.7;
    this.mesh.visible = true;
  }

  pick(o, d) {
    if (this.state === 'none' || this.state === 'leave') return null;
    const ox = this.pos.x - o.x, oy = this.pos.y - o.y, oz = this.pos.z - o.z;
    const t = ox * d.x + oy * d.y + oz * d.z;
    if (t < 0) return null;
    const dist2 = ox * ox + oy * oy + oz * oz - t * t;
    return dist2 < 0.17 * 0.17 ? { prop: { type: 'butterfly' }, t } : null;
  }

  shoo() {
    if (this.state === 'none') return;
    this.state = 'leave';
    this.t = 0;
    this.goal.set(this.pos.x > 0 ? 3 : -3, 2.4, -1);
  }

  /**
   * @param nose world position of Lumi's nose (landing spot)
   * @param canLand whether Lumi is calm enough to be landed on
   */
  update(dt, time, nose, canLand) {
    if (this.state === 'none') return;
    this.t += dt;
    let flap = 0.9 * Math.sin(time * 26 + this.seed);
    const wanderCenter = new THREE.Vector3(0, 1.05, 0.75);
    if (this.state === 'enter' || this.state === 'wander') {
      // lazy figure-eights in front of Lumi
      const a = time * 0.9 + this.seed;
      this.goal.set(wanderCenter.x + Math.sin(a) * 0.62, wanderCenter.y + Math.sin(a * 1.7) * 0.22 + Math.sin(time * 5 + this.seed) * 0.05, wanderCenter.z + Math.cos(a * 0.8) * 0.2);
      if (this.state === 'enter' && this.pos.distanceTo(this.goal) < 0.5) {
        this.state = 'wander';
        this.t = 0;
      }
      if (this.state === 'wander' && this.t > 4.5) {
        if (this.wantsToLand && canLand) {
          this.state = 'land';
          this.t = 0;
        } else if (this.t > 9) this.shoo();
      }
    } else if (this.state === 'land') {
      this.goal.copy(nose).add(new THREE.Vector3(0, 0.03, 0.03));
      if (this.pos.distanceTo(this.goal) < 0.035) {
        this.state = 'perch';
        this.t = 0;
        this.onLanded();
      } else if (this.t > 4) this.shoo();
    } else if (this.state === 'perch') {
      this.pos.copy(nose).add(new THREE.Vector3(0, 0.028, 0.028));
      this.vel.set(0, 0, 0);
      flap = 0.5 + 0.45 * Math.sin(time * 3.2); // slow, resting wing beats
      if (this.t > 3.2) this.shoo();
    } else if (this.state === 'leave') {
      if (this.pos.y > 2.2 || Math.abs(this.pos.x) > 2.6 || this.t > 5) {
        this.state = 'none';
        this.mesh.visible = false;
        this.onGone();
        return;
      }
    }
    if (this.state !== 'perch') {
      // steer toward the goal with a fluttery, slightly drunken path
      const k = this.state === 'land' ? 5 : 2.2;
      const desired = this.goal.clone().sub(this.pos).multiplyScalar(k);
      desired.clampLength(0, this.state === 'leave' ? 1.6 : 1.0);
      this.vel.lerp(desired, 1 - Math.exp(-dt * 3));
      this.pos.addScaledVector(this.vel, dt);
      this.pos.y += Math.sin(time * 13 + this.seed) * 0.0035;
    }
    const m = this.mesh;
    m.position.copy(this.pos);
    // face along the direction of travel, wings spread level
    const heading = this.state === 'perch' ? Math.PI : Math.atan2(this.vel.x, this.vel.z);
    m.rotation.set(-0.35, heading, 0, 'YXZ');
    this.material.uniforms.uFlap.value = flap;
  }
}
