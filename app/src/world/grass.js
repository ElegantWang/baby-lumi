// Wind-blown grass and wildflowers, drawn as instanced blades.
import * as THREE from 'three';
import { WORLD_GLSL } from './atmosphere.js';
import { terrainHeight, SHADOW_PICK_GLSL } from './terrain.js';

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BLADE_COMMON = /* glsl */ `
uniform vec4 uWind;
uniform float uTime;
uniform vec3 uLumiPos;
float bhash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float bnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bhash(i), bhash(i + vec2(1, 0)), f.x), mix(bhash(i + vec2(0, 1)), bhash(i + vec2(1, 1)), f.x), f.y);
}
// horizontal sway of a stalk rooted at 'root'
vec2 windBend(vec2 root, float rnd) {
  float gust = bnoise(root * 0.22 - uWind.xy * uTime * 0.55);
  float ripple = sin(uTime * 2.6 + rnd * 6.283 + root.x * 1.9 + root.y * 1.3);
  return uWind.xy * ((gust - 0.35) * 1.5 * uWind.z + ripple * 0.045);
}`;

const grassVert = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
attribute vec3 aOffset;
attribute vec4 aParams; // yaw, height, lean, random
varying float vT;
varying float vRand;
varying vec3 vWorldPos;
varying vec3 vN;
varying float vNearLumi;
${BLADE_COMMON}
void main() {
  float t = position.y;
  float side = position.x;
  float yaw = aParams.x, height = aParams.y, lean = aParams.z, rnd = aParams.w;

  // grass is short and pressed outward where Lumi stands
  vec2 toL = aOffset.xz - uLumiPos.xz;
  float dl = length(toL);
  float clear = smoothstep(0.22, 0.8, dl);
  height *= mix(0.3, 1.0, clear);

  vec2 dir = vec2(cos(yaw), sin(yaw));
  vec2 wdir = vec2(-dir.y, dir.x);
  float camDist = distance(aOffset, cameraPosition);
  float width = (0.0105 + 0.007 * rnd) * (1.0 + camDist * 0.085) * (1.0 - 0.88 * t * t);

  vec2 bend = dir * lean + windBend(aOffset.xz, rnd);
  bend += normalize(toL + 1e-4) * (1.0 - clear) * 0.55;
  float curve = t * t;
  float bl = length(bend);
  vec3 p = aOffset;
  p.xz += wdir * side * width + bend * curve * height;
  p.y += t * height * (1.0 - 0.3 * min(bl * bl, 1.0) * curve);

  vT = t;
  vRand = rnd;
  vNearLumi = 1.0 - smoothstep(0.1, 0.7, dl);
  // blades are lit like soft tufts: mostly "up", nudged by their lean
  vec3 nrm = normalize(vec3(bend.x * 0.6 + dir.x * 0.25, 1.0, bend.y * 0.6 + dir.y * 0.25));
  vN = nrm;
  vec3 transformedNormal = normalMatrix * nrm;
  vec4 worldPosition = vec4(p, 1.0);
  vWorldPos = p;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <shadowmap_vertex>
}`;

const grassFrag = /* glsl */ `
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
${SHADOW_PICK_GLSL}
uniform vec3 uGrassTint;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
varying float vT;
varying float vRand;
varying vec3 vWorldPos;
varying vec3 vN;
varying float vNearLumi;
${WORLD_GLSL}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float patches = wfbm(vWorldPos.xz * 0.33 + 3.1);
  vec3 tipCol = uGrassTint * mix(vec3(0.7, 0.95, 0.62), vec3(1.12, 1.02, 0.6), patches * 0.8 + vRand * 0.3);
  vec3 rootCol = uGrassTint * vec3(0.22, 0.44, 0.3);
  vec3 albedo = mix(rootCol, tipCol, smoothstep(0.0, 0.85, vT));

  float shadow = shadowFrom(1);
  float sun = clamp(dot(N, uSunDir) * 0.6 + 0.4, 0.0, 1.0);
  // sunlight glowing through the blades when we look toward the sun
  float back = pow(clamp(dot(V, -uSunDir) * 0.5 + 0.5, 0.0, 1.0), 2.0);
  vec3 light = uSunColor * (sun * 0.3 + back * vT * 0.26) * shadow + mix(uGroundColor, uSkyColor, 0.45 + 0.5 * vT) * 0.82;
  float ao = mix(0.5, 1.0, vT) * (1.0 - 0.45 * vNearLumi * (1.0 - vT));
  vec3 col = albedo * light * ao;
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}`;

function bladeGeometry(segments = 4) {
  const pos = [], idx = [];
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    pos.push(-1, t, 0, 1, t, 0);
  }
  pos.push(0, 1, 0);
  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const a = (segments - 1) * 2;
  idx.push(a, a + 1, a + 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

/** Is (x, z) somewhere the camera can plausibly see? (a wedge in front of the camera) */
function inView(x, z, margin = 1) {
  const camZ = 5.2;
  const d = camZ - z;
  if (d < 0.6) return false;
  return Math.abs(x) < margin + d * 0.74;
}

function shared(env) {
  const u = env.uniforms;
  return {
    uWind: u.uWind, uTime: u.uTime, uLumiPos: u.uLumiPos, uGrassTint: u.uGrassTint, uSkyColor: u.uSkyColor,
    uGroundColor: u.uGroundColor, uFogColor: u.uFogColor, uFogDensity: u.uFogDensity, uSunDir: u.uSunDir, uSunColor: u.uSunColor,
  };
}

export function createGrass(env, count = 26000) {
  const rand = mulberry(77123);
  const offsets = new Float32Array(count * 3);
  const params = new Float32Array(count * 4);
  let n = 0, guard = 0;
  while (n < count && guard++ < count * 40) {
    // density falls off with distance from the hilltop
    const r = 0.25 + Math.pow(rand(), 1.75) * 17;
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!inView(x, z)) continue;
    offsets.set([x, terrainHeight(x, z), z], n * 3);
    // grass right in front of the camera is kept a little shorter so it frames Lumi without hiding her feet
    const near = z > 2.2 ? 0.85 : 1;
    params.set([rand() * Math.PI * 2, (0.085 + rand() * 0.13 + (rand() < 0.08 ? 0.09 : 0)) * near, 0.15 + rand() * 0.45, rand()], n * 4);
    n++;
  }
  const geo = new THREE.InstancedBufferGeometry();
  const blade = bladeGeometry(4);
  geo.setAttribute('position', blade.attributes.position);
  geo.setIndex(blade.index);
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets.subarray(0, n * 3), 3));
  geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params.subarray(0, n * 4), 4));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights), ...shared(env) },
    vertexShader: grassVert,
    fragmentShader: grassFrag,
    side: THREE.DoubleSide,
    lights: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.name = 'grass';
  mesh.userData.total = n;
  return mesh;
}

// ---- flowers ---------------------------------------------------------------------------

const flowerVert = /* glsl */ `
attribute vec3 aOffset;
attribute vec4 aParams; // stem height, head size, random, kind
attribute vec3 aColor;
varying vec2 vUv;
varying float vPart;
varying vec3 vColor;
varying vec3 vWorldPos;
varying float vKind;
varying float vRand;
${BLADE_COMMON}
void main() {
  float part = position.z;        // 0 = stem, 1 = flower head
  float height = aParams.x, size = aParams.y, rnd = aParams.z;
  vec2 toL = aOffset.xz - uLumiPos.xz;
  float clear = smoothstep(0.3, 0.8, length(toL));
  height *= mix(0.4, 1.0, clear);
  vec2 bend = windBend(aOffset.xz, rnd) * 0.8 + vec2(rnd - 0.5, fract(rnd * 7.3) - 0.5) * 0.12;
  vec3 top = aOffset + vec3(bend.x * height, height, bend.y * height);
  vec3 p;
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  if (part < 0.5) {
    float t = position.y;
    p = mix(aOffset, top, t) + vec3(bend.x, 0.0, bend.y) * height * (t * t - t) * 0.6;
    p += right * position.x * 0.004;
  } else {
    // the head faces the camera, tilted up toward the sky a little
    vec3 up = normalize(vec3(0.0, 0.55, 0.0) + vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
    float wob = sin(uTime * 1.7 + rnd * 40.0) * 0.12;
    float c = cos(wob), s = sin(wob);
    vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
    p = top + (right * q.x + up * q.y) * size;
  }
  vUv = position.xy;
  vPart = part;
  vColor = aColor;
  vKind = aParams.w;
  vRand = rnd;
  vWorldPos = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const flowerFrag = /* glsl */ `
uniform vec3 uGrassTint;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
varying vec2 vUv;
varying float vPart;
varying vec3 vColor;
varying vec3 vWorldPos;
varying float vKind;
varying float vRand;
${WORLD_GLSL}
void main() {
  vec3 albedo;
  if (vPart < 0.5) {
    albedo = uGrassTint * vec3(0.3, 0.55, 0.28);
  } else {
    float r = length(vUv);
    float a = atan(vUv.y, vUv.x) + vRand * 6.283;
    float petals = vKind < 0.5 ? 9.0 : 5.0;
    float sharp = vKind < 0.5 ? 0.5 : 0.85;
    float edge = mix(1.0 - sharp, 1.0, pow(abs(cos(a * petals * 0.5)), 0.6));
    if (r > edge) discard;
    float center = 1.0 - smoothstep(0.2, 0.27, r);
    vec3 petal = vColor * (0.72 + 0.4 * smoothstep(0.15, 0.9, r));
    albedo = mix(petal, vec3(1.0, 0.72, 0.12), center);
  }
  vec3 light = uSunColor * 0.27 + mix(uGroundColor, uSkyColor, 0.7) * 0.85;
  vec3 col = albedo * light;
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}`;

const FLOWER_PALETTE = [
  [1.0, 1.0, 1.0, 0], // daisy
  [1.0, 1.0, 1.0, 0],
  [1.0, 0.62, 0.78, 1], // pink
  [0.78, 0.66, 1.0, 1], // lilac
  [1.0, 0.86, 0.3, 1], // buttercup
  [0.62, 0.8, 1.0, 1], // forget-me-not
];

/** An instanced patch of flowers whose instances can be written at any time. */
export function createFlowerPatch(env, capacity) {
  // geometry: a stem ribbon (z = 0) and a head quad (z = 1)
  const pos = [], idx = [];
  const SEG = 3;
  for (let i = 0; i <= SEG; i++) pos.push(-1, i / SEG, 0, 1, i / SEG, 0);
  for (let i = 0; i < SEG; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const h0 = pos.length / 3;
  pos.push(-1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1);
  idx.push(h0, h0 + 1, h0 + 2, h0, h0 + 2, h0 + 3);
  const offsets = new Float32Array(capacity * 3);
  const params = new Float32Array(capacity * 4);
  const colors = new Float32Array(capacity * 3);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const aOffset = new THREE.InstancedBufferAttribute(offsets, 3);
  const aParams = new THREE.InstancedBufferAttribute(params, 4);
  const aColor = new THREE.InstancedBufferAttribute(colors, 3);
  geo.setAttribute('aOffset', aOffset);
  geo.setAttribute('aParams', aParams);
  geo.setAttribute('aColor', aColor);
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: shared(env),
    vertexShader: flowerVert,
    fragmentShader: flowerFrag,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, offsets, params, colors, aOffset, aParams, aColor, palette: FLOWER_PALETTE };
}

export function createFlowers(env, count = 190) {
  const rand = mulberry(5150);
  const patch = createFlowerPatch(env, count);
  let n = 0, guard = 0;
  while (n < count && guard++ < count * 60) {
    const r = 0.75 + Math.pow(rand(), 1.5) * 11;
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!inView(x, z, 0.6)) continue;
    if (z > 1.2 && Math.abs(x) < 0.7 + (z - 1.2) * 0.32) continue;
    const c = FLOWER_PALETTE[Math.floor(rand() * FLOWER_PALETTE.length)];
    patch.offsets.set([x, terrainHeight(x, z), z], n * 3);
    const big = 1 + r * 0.03;
    patch.params.set([0.15 + rand() * 0.12, (0.032 + rand() * 0.022) * big, rand(), c[3]], n * 4);
    patch.colors.set([c[0], c[1], c[2]], n * 3);
    n++;
  }
  patch.mesh.geometry.instanceCount = n;
  patch.mesh.name = 'flowers';
  return patch.mesh;
}
