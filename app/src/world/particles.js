// Ambient life in the air: drifting pollen motes by day, fireflies at night.
import * as THREE from 'three';

const vert = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uPixelRatio;
uniform float uSize;
uniform float uMode; // 0 = pollen, 1 = fireflies
varying float vAlpha;
varying float vSeed;
void main() {
  vec3 p = position;
  float t = uTime * (0.25 + aSeed.x * 0.35);
  // lazy wander; pollen also rises and wraps around
  p.x += sin(t * 1.3 + aSeed.y * 6.283) * 0.35 + sin(t * 0.37 + aSeed.z * 9.0) * 0.6;
  p.z += cos(t * 1.1 + aSeed.z * 6.283) * 0.35;
  float rise = uMode < 0.5 ? fract(aSeed.w + uTime * 0.012 * (0.5 + aSeed.x)) : 0.5 + 0.18 * sin(t * 0.9 + aSeed.w * 6.283);
  p.y = mix(0.05, uMode < 0.5 ? 3.2 : 1.5, rise) + sin(t * 2.1 + aSeed.x * 20.0) * 0.06;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float blink = uMode < 0.5
    ? 0.55 + 0.45 * sin(uTime * (0.8 + aSeed.y) + aSeed.z * 30.0)
    : smoothstep(0.2, 0.9, sin(uTime * (0.9 + aSeed.y * 1.4) + aSeed.z * 30.0));
  float edge = uMode < 0.5 ? smoothstep(0.0, 0.12, rise) * smoothstep(1.0, 0.8, rise) : 1.0;
  vAlpha = blink * edge;
  vSeed = aSeed.x;
  gl_PointSize = uSize * uPixelRatio * (0.6 + aSeed.w * 0.8) / max(-mv.z, 0.5);
}`;

const frag = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying float vAlpha;
varying float vSeed;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q);
  float core = smoothstep(0.5, 0.0, d);
  float a = core * core * vAlpha * uStrength;
  gl_FragColor = vec4(uColor * a, a);
}`;

function makePoints(count, mode, seed, spread) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const pos = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos.set([(rand() * 2 - 1) * spread[0], 0, spread[1] + rand() * (spread[2] - spread[1])], i * 3);
    seeds.set([rand(), rand(), rand(), rand()], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uSize: { value: mode === 0 ? 46 : 70 },
      uMode: { value: mode },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uStrength: { value: 1 },
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 50;
  return pts;
}

export class AirLife {
  constructor(env) {
    this.env = env;
    this.group = new THREE.Group();
    this.pollen = makePoints(70, 0, 91, [4.5, -9, 3]);
    this.fireflies = makePoints(34, 1, 407, [3.6, -7, 2.4]);
    this.group.add(this.pollen, this.fireflies);
  }
  update(time, pixelHeight) {
    const s = this.env.state;
    const scale = pixelHeight / 900;
    const p = this.pollen.material.uniforms, f = this.fireflies.material.uniforms;
    p.uTime.value = time;
    f.uTime.value = time;
    p.uPixelRatio.value = scale;
    f.uPixelRatio.value = scale;
    p.uColor.value.copy(this.env.uniforms.uSunColor.value).multiplyScalar(0.5);
    p.uStrength.value = 0.55 * (1 - s.night);
    f.uColor.value.setRGB(1.0, 0.95, 0.35).multiplyScalar(2.2);
    f.uStrength.value = s.fireflies;
    this.pollen.visible = p.uStrength.value > 0.01;
    this.fireflies.visible = s.fireflies > 0.01;
  }
}
