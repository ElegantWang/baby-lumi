// Light and colour for the whole world, driven by the time of day.
// One shared bag of uniforms feeds every shader (character, grass, sky ...),
// so the scene always stays in one coherent mood.
import * as THREE from 'three';

const C = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

// Key frames around the clock. Colours are sRGB hex (converted to linear) with
// an intensity multiplier. `key` is the soft light on Lumi's face, `sun` the
// warm back light that rims her fur and throws her shadow across the grass.
const KEYS = [
  {
    hour: 0, name: 'night',
    zenith: C(0x050b2e), horizon: C(0x1c2f6e), fog: C(0x14204e), fogDensity: 0.016,
    sun: C(0x9db8ff, 0.9), sunElev: 38, key: C(0xa8c0ff, 0.62), ambSky: C(0x4458b0, 0.42), ambGround: C(0x1f2a52, 0.3),
    stars: 1, sunDisc: 0.0, moon: 1, grass: C(0x3f6f8a), exposure: 1.08, saturation: 1.0, fireflies: 1,
  },
  {
    hour: 5.2, name: 'late night',
    zenith: C(0x081238), horizon: C(0x243a7c), fog: C(0x1a2858), fogDensity: 0.016,
    sun: C(0x9db8ff, 0.9), sunElev: 30, key: C(0xa8c0ff, 0.62), ambSky: C(0x4458b0, 0.42), ambGround: C(0x1f2a52, 0.3),
    stars: 1, sunDisc: 0.0, moon: 1, grass: C(0x3f6f8a), exposure: 1.08, saturation: 1.0, fireflies: 1,
  },
  {
    hour: 6.5, name: 'dawn',
    zenith: C(0x4f78cc), horizon: C(0xffc9ae), fog: C(0xf2cdbd), fogDensity: 0.02,
    sun: C(0xffb48a, 1.7), sunElev: 7, key: C(0xffe1d2, 0.92), ambSky: C(0x9fb2ee, 0.46), ambGround: C(0x6e7a52, 0.28),
    stars: 0.0, sunDisc: 1, moon: 0, grass: C(0x86b46a), exposure: 1.0, saturation: 1.04, fireflies: 0,
  },
  {
    hour: 9, name: 'morning',
    zenith: C(0x4f9cf0), horizon: C(0xdff0ff), fog: C(0xdcecf7), fogDensity: 0.013,
    sun: C(0xfff0d4, 1.9), sunElev: 30, key: C(0xfff3e2, 1.08), ambSky: C(0xa8c6ff, 0.52), ambGround: C(0x7f9a52, 0.34),
    stars: 0, sunDisc: 1, moon: 0, grass: C(0x8fc45f), exposure: 1.0, saturation: 1.08, fireflies: 0,
  },
  {
    hour: 13, name: 'noon',
    zenith: C(0x3d8fee), horizon: C(0xcfe8ff), fog: C(0xcfe4f6), fogDensity: 0.011,
    sun: C(0xfff6e4, 2.0), sunElev: 50, key: C(0xfff7ea, 1.14), ambSky: C(0xa6c6ff, 0.56), ambGround: C(0x86a052, 0.36),
    stars: 0, sunDisc: 1, moon: 0, grass: C(0x8cc859), exposure: 1.0, saturation: 1.1, fireflies: 0,
  },
  {
    hour: 16.5, name: 'afternoon',
    zenith: C(0x4a90e6), horizon: C(0xffe9c8), fog: C(0xf6e3c6), fogDensity: 0.014,
    sun: C(0xffe0ae, 2.2), sunElev: 24, key: C(0xfff0da, 1.1), ambSky: C(0xa4bdf6, 0.5), ambGround: C(0x8c9a50, 0.36),
    stars: 0, sunDisc: 1, moon: 0, grass: C(0x9cc457), exposure: 1.0, saturation: 1.1, fireflies: 0,
  },
  {
    hour: 18.6, name: 'golden hour',
    zenith: C(0x5a82d0), horizon: C(0xffc78c), fog: C(0xffcf9e), fogDensity: 0.02,
    sun: C(0xffb066, 2.5), sunElev: 9, key: C(0xffe3c2, 1.0), ambSky: C(0x9aaae8, 0.44), ambGround: C(0x8f8a4c, 0.33),
    stars: 0, sunDisc: 1, moon: 0, grass: C(0xa8b851), exposure: 1.0, saturation: 1.1, fireflies: 0.15,
  },
  {
    hour: 19.8, name: 'dusk',
    zenith: C(0x2a3c8c), horizon: C(0xf29a98), fog: C(0xb48cb0), fogDensity: 0.02,
    sun: C(0xff9c86, 1.3), sunElev: 3, key: C(0xe9c9de, 0.78), ambSky: C(0x7f88d8, 0.42), ambGround: C(0x55527c, 0.27),
    stars: 0.35, sunDisc: 0.4, moon: 0, grass: C(0x6f9a78), exposure: 1.04, saturation: 1.04, fireflies: 0.8,
  },
  {
    hour: 21, name: 'nightfall',
    zenith: C(0x050b2e), horizon: C(0x1c2f6e), fog: C(0x14204e), fogDensity: 0.016,
    sun: C(0x9db8ff, 0.9), sunElev: 38, key: C(0xa8c0ff, 0.62), ambSky: C(0x4458b0, 0.42), ambGround: C(0x1f2a52, 0.3),
    stars: 1, sunDisc: 0.0, moon: 1, grass: C(0x3f6f8a), exposure: 1.08, saturation: 1.0, fireflies: 1,
  },
  { hour: 24 }, // wraps to the first key
];
Object.assign(KEYS[KEYS.length - 1], { ...KEYS[0], hour: 24 });

const COLOR_FIELDS = ['zenith', 'horizon', 'fog', 'sun', 'key', 'ambSky', 'ambGround', 'grass'];
const NUM_FIELDS = ['fogDensity', 'sunElev', 'stars', 'sunDisc', 'moon', 'exposure', 'saturation', 'fireflies'];

export class Atmosphere {
  constructor() {
    this.uniforms = {
      uTime: { value: 0 },
      uExposure: { value: 1 },
      uKeyDir: { value: new THREE.Vector3(-0.42, 0.66, 0.62).normalize() },
      uKeyColor: { value: new THREE.Color() },
      uRimDir: { value: new THREE.Vector3() }, // toward the sun / moon
      uRimColor: { value: new THREE.Color() },
      uSkyColor: { value: new THREE.Color() },
      uGroundColor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0.012 },
      uStars: { value: 0 },
      uSunDisc: { value: 1 },
      uMoon: { value: 0 },
      uGrassTint: { value: new THREE.Color() },
      uWind: { value: new THREE.Vector4(1, 0, 0.35, 0) }, // dir.xz, strength, gust phase
      uLumiPos: { value: new THREE.Vector3() },
    };
    this.state = { saturation: 1.08, exposure: 1, fireflies: 0, night: 0, name: 'noon', hour: 13 };
    this.gust = 0; // set to 1 for a puff of wind; it dies away on its own

    // Light 0: soft key on Lumi (self shadows). Light 1: the sun (ground shadow).
    this.keyLight = this.#makeLight(1.35, 2048);
    this.sunLight = this.#makeLight(2.6, 2048);
    this.keyLight.shadow.radius = 5;
    this.sunLight.shadow.radius = 3.5;
    this.group = new THREE.Group();
    this.group.add(this.keyLight, this.keyLight.target, this.sunLight, this.sunLight.target);
    this.center = new THREE.Vector3(0, 0.6, 0);
    this.setHour(13);
  }

  #makeLight(extent, size) {
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.castShadow = true;
    light.shadow.mapSize.set(size, size);
    const cam = light.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 0.5;
    cam.far = 14;
    light.shadow.bias = -0.0012;
    light.shadow.normalBias = 0.022;
    return light;
  }

  /** @param {number} hour 0..24 (fractional) */
  setHour(hour) {
    hour = ((hour % 24) + 24) % 24;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].hour <= hour) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    let t = (hour - a.hour) / (b.hour - a.hour);
    t = t * t * (3 - 2 * t);
    const v = {};
    for (const f of COLOR_FIELDS) v[f] = a[f].clone().lerp(b[f], t);
    for (const f of NUM_FIELDS) v[f] = a[f] + (b[f] - a[f]) * t;

    const u = this.uniforms;
    u.uZenith.value.copy(v.zenith);
    u.uHorizon.value.copy(v.horizon);
    u.uFogColor.value.copy(v.fog);
    u.uFogDensity.value = v.fogDensity;
    u.uKeyColor.value.copy(v.key);
    u.uRimColor.value.copy(v.sun);
    u.uSunColor.value.copy(v.sun);
    u.uSkyColor.value.copy(v.ambSky);
    u.uGroundColor.value.copy(v.ambGround);
    u.uGrassTint.value.copy(v.grass);
    u.uStars.value = v.stars;
    u.uSunDisc.value = v.sunDisc;
    u.uMoon.value = v.moon;

    // the sun (or moon) sits behind Lumi, off to the viewer's right
    const elev = THREE.MathUtils.degToRad(v.sunElev);
    const az = THREE.MathUtils.degToRad(32);
    const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev)).normalize();
    u.uSunDir.value.copy(sunDir);
    // the rim light direction is kept a little higher than a very low sun so fur always catches it
    u.uRimDir.value.set(sunDir.x, Math.max(sunDir.y, 0.28), sunDir.z).normalize();

    this.keyLight.position.copy(this.center).addScaledVector(u.uKeyDir.value, 6);
    this.keyLight.target.position.copy(this.center);
    // shadow-casting sun never drops below ~16 degrees, otherwise the shadow stretches forever
    const shadowDir = new THREE.Vector3(sunDir.x, Math.max(sunDir.y, 0.3), sunDir.z).normalize();
    this.sunLight.position.copy(this.center).addScaledVector(shadowDir, 7);
    this.sunLight.target.position.copy(this.center);
    this.shadowDir = shadowDir;

    this.state.saturation = v.saturation;
    this.state.exposure = v.exposure;
    this.state.fireflies = v.fireflies;
    this.state.night = v.stars;
    this.state.name = t < 0.5 ? a.name : b.name;
    this.state.hour = hour;
  }

  update(time, dt = 0.016) {
    const u = this.uniforms;
    u.uTime.value = time;
    this.gust *= Math.exp(-dt * 1.1);
    // slow breathing gusts
    u.uWind.value.z = 0.28 + 0.14 * Math.sin(time * 0.31) + 0.08 * Math.sin(time * 0.77 + 1.3) + this.gust * 1.1;
    u.uWind.value.w = time;
  }
}

/** Shared GLSL: fog / aerial perspective and noise helpers. */
export const WORLD_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
vec3 applyFog(vec3 col, vec3 worldPos) {
  vec3 toP = worldPos - cameraPosition;
  float d = length(toP);
  float f = 1.0 - exp(-d * uFogDensity);
  float sunAmt = pow(max(dot(toP / d, uSunDir), 0.0), 5.0);
  vec3 fogCol = mix(uFogColor, uSunColor * 0.55 + uFogColor * 0.45, sunAmt * 0.7);
  return mix(col, fogCol, f);
}
float whash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float wnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(whash(i), whash(i + vec2(1, 0)), f.x), mix(whash(i + vec2(0, 1)), whash(i + vec2(1, 1)), f.x), f.y);
}
float wfbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * wnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;
