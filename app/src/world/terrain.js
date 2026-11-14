// The meadow: a knoll Lumi stands on, rolling ground around it, layered far
// hills and soft round trees in the distance.
import * as THREE from 'three';
import { WORLD_GLSL } from './atmosphere.js';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Height of the ground at (x, z). Flat on the hilltop, rolling farther out. */
export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  const roll =
    Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17 - 0.4) * 0.9 +
    Math.sin(x * 0.073 - z * 0.091 + 0.6) * 2.0 +
    Math.sin(x * 0.45 + z * 0.38) * 0.18;
  return roll * smoothstep(2.6, 16, r) - smoothstep(3.5, 46, r) * 4.2;
}

/** Shadow lookups that pick one specific light (0 = key on Lumi, 1 = sun). */
export const SHADOW_PICK_GLSL = /* glsl */ `
float shadowFrom(const int which) {
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1
    if (which == 0) {
      DirectionalLightShadow s = directionalLightShadows[0];
      return getShadow(directionalShadowMap[0], s.shadowMapSize, s.shadowIntensity, s.shadowBias, s.shadowRadius, vDirectionalShadowCoord[0]);
    }
    DirectionalLightShadow s1 = directionalLightShadows[1];
    return getShadow(directionalShadowMap[1], s1.shadowMapSize, s1.shadowIntensity, s1.shadowBias, s1.shadowRadius, vDirectionalShadowCoord[1]);
  #elif defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow s = directionalLightShadows[0];
    return getShadow(directionalShadowMap[0], s.shadowMapSize, s.shadowIntensity, s.shadowBias, s.shadowRadius, vDirectionalShadowCoord[0]);
  #else
    return 1.0;
  #endif
}`;

const groundVert = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
varying vec3 vWorldPos;
varying vec3 vN;
void main() {
  vec3 transformedNormal = normalMatrix * normal;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <shadowmap_vertex>
}`;

const groundFrag = /* glsl */ `
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
${SHADOW_PICK_GLSL}
uniform vec3 uGrassTint;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uLumiPos;
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vN;
${WORLD_GLSL}
void main() {
  vec3 N = normalize(vN);
  float patches = wfbm(vWorldPos.xz * 0.33 + 3.1);
  float fine = wnoise(vWorldPos.xz * 7.0);
  float r = length(vWorldPos.xz);
  // close up the ground is the shaded soil between blades; far away it stands in for the grass itself
  vec3 near = uGrassTint * vec3(0.3, 0.46, 0.26);
  vec3 far = uGrassTint * mix(vec3(0.6, 0.86, 0.5), vec3(0.95, 1.0, 0.56), patches);
  vec3 albedo = mix(near, far, smoothstep(1.5, 9.0, r)) * (0.86 + 0.28 * fine);

  float sun = clamp(dot(N, uSunDir), 0.0, 1.0);
  float shadow = shadowFrom(1);
  vec3 light = uSunColor * sun * shadow * 0.34 + mix(uGroundColor, uSkyColor, 0.8) * 0.85;
  // contact shadow: the ground darkens right under Lumi
  float contact = 1.0 - 0.6 * (1.0 - smoothstep(0.05, 0.62, length(vWorldPos.xz - uLumiPos.xz))) * (1.0 - smoothstep(0.0, 0.5, uLumiPos.y));
  vec3 col = albedo * light * contact;
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}`;

function lightUniforms() {
  return THREE.UniformsUtils.clone(THREE.UniformsLib.lights);
}

export function createGround(env) {
  const u = env.uniforms;
  // polar grid: fine near the hilltop, coarse in the distance
  const RINGS = 72, SEGS = 120, RMAX = 150;
  const pos = [], idx = [];
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const r = RMAX * Math.pow(t, 2.4);
    for (let j = 0; j <= SEGS; j++) {
      const a = (j / SEGS) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      pos.push(x, terrainHeight(x, z), z);
    }
  }
  const row = SEGS + 1;
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEGS; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...lightUniforms(),
      uGrassTint: u.uGrassTint, uSkyColor: u.uSkyColor, uGroundColor: u.uGroundColor, uLumiPos: u.uLumiPos, uTime: u.uTime,
      uFogColor: u.uFogColor, uFogDensity: u.uFogDensity, uSunDir: u.uSunDir, uSunColor: u.uSunColor,
    },
    vertexShader: groundVert,
    fragmentShader: groundFrag,
    lights: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}

// ---- far hills --------------------------------------------------------------------

const hillVert = /* glsl */ `
varying vec3 vWorldPos;
varying float vTop;
attribute float aTop;
void main() {
  vTop = aTop;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const hillFrag = /* glsl */ `
uniform vec3 uGrassTint;
uniform vec3 uSkyColor;
uniform float uShade;
varying vec3 vWorldPos;
varying float vTop;
${WORLD_GLSL}
void main() {
  float n = wfbm(vWorldPos.xz * 0.05 + vWorldPos.y * 0.07);
  vec3 col = uGrassTint * mix(vec3(0.34, 0.56, 0.36), vec3(0.62, 0.82, 0.45), vTop * 0.7 + n * 0.5) * uShade;
  col *= 0.55 + 0.22 * uSunColor * vTop;
  col += uSkyColor * 0.12;
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}`;

function hillNoise(a, seed) {
  return (
    Math.sin(a * 2.1 + seed) * 0.5 +
    Math.sin(a * 4.7 + seed * 2.3) * 0.28 +
    Math.sin(a * 9.3 + seed * 0.7) * 0.14 +
    Math.sin(a * 17.0 + seed * 5.1) * 0.06
  );
}

export function createHills(env) {
  const u = env.uniforms;
  const group = new THREE.Group();
  group.name = 'hills';
  const layers = [
    { r: 70, base: -4.5, amp: 5.0, seed: 1.7, shade: 0.95 },
    { r: 115, base: -3, amp: 9, seed: 4.2, shade: 0.9 },
    { r: 190, base: -2, amp: 17, seed: 8.9, shade: 0.85 },
  ];
  for (const L of layers) {
    const SEG = 160;
    const pos = [], top = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
      const a = -Math.PI * 0.5 + ((i / SEG) * 2 - 1) * Math.PI * 0.8; // centred on -Z
      const x = Math.cos(a) * L.r, z = Math.sin(a) * L.r;
      const h = L.base + L.amp * (0.55 + hillNoise(a * 1.0, L.seed));
      pos.push(x, h, z, x * 0.96, h - L.amp * 0.5, z * 0.96 + 0, x * 0.9, -14, z * 0.9);
      top.push(1, 0.6, 0);
    }
    for (let i = 0; i < SEG; i++) {
      const a = i * 3;
      idx.push(a, a + 1, a + 3, a + 3, a + 1, a + 4, a + 1, a + 2, a + 4, a + 4, a + 2, a + 5);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uGrassTint: u.uGrassTint, uSkyColor: u.uSkyColor, uShade: { value: L.shade },
        uFogColor: u.uFogColor, uFogDensity: u.uFogDensity, uSunDir: u.uSunDir, uSunColor: u.uSunColor,
      },
      vertexShader: hillVert,
      fragmentShader: hillFrag,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}

// ---- trees --------------------------------------------------------------------------

const treeVert = /* glsl */ `
attribute float aPart;
attribute vec3 aTint;
varying vec3 vWorldPos;
varying vec3 vN;
varying float vPart;
varying vec3 vTint;
varying float vH;
uniform float uTime;
uniform vec4 uWind;
void main() {
  vPart = aPart;
  vTint = aTint;
  vH = position.y;
  vec3 p = position;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  // canopies breathe in the wind
  wp.xz += uWind.xy * sin(uTime * 0.9 + wp.x * 0.3 + wp.z * 0.2) * 0.06 * aPart * uWind.z * 3.0;
  vWorldPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const treeFrag = /* glsl */ `
uniform vec3 uGrassTint;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
varying vec3 vWorldPos;
varying vec3 vN;
varying float vPart;
varying vec3 vTint;
varying float vH;
${WORLD_GLSL}
void main() {
  vec3 N = normalize(vN);
  vec3 leaf = uGrassTint * vTint;
  vec3 trunk = vec3(0.32, 0.22, 0.16);
  vec3 albedo = mix(trunk, leaf, vPart);
  float sun = clamp(dot(N, uSunDir) * 0.6 + 0.4, 0.0, 1.0);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.0) * clamp(dot(N, uSunDir) + 0.6, 0.0, 1.0);
  vec3 col = albedo * (uSunColor * sun * 0.36 + mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5) * 0.85);
  col += leaf * uSunColor * rim * 0.2 * vPart;
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}`;

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

export function createTrees(env, count = 90) {
  const u = env.uniforms;
  const rand = mulberry(20240607);
  // one tree = a trunk and a lumpy canopy, merged
  const trunk = new THREE.CylinderGeometry(0.09, 0.14, 1.2, 7).translate(0, 0.6, 0);
  const canopy = new THREE.IcosahedronGeometry(1, 5);
  const cp = canopy.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
    const bump = 1 + 0.11 * Math.sin(x * 3.1 + y * 2.3) * Math.cos(z * 2.9 + x * 1.7) + 0.06 * Math.sin(y * 4.6 + z * 4.1);
    cp.setXYZ(i, x * bump * 1.05, y * bump * 0.92 + 1.9, z * bump * 1.05);
  }
  // blobby canopies read best with soft, radial normals
  const cn = canopy.attributes.normal;
  for (let i = 0; i < cp.count; i++) {
    const v = new THREE.Vector3(cp.getX(i), (cp.getY(i) - 1.9) * 1.1 + 0.25, cp.getZ(i)).normalize();
    cn.setXYZ(i, v.x, v.y, v.z);
  }
  const merged = mergeParts([trunk, canopy], [0, 1]);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uGrassTint: u.uGrassTint, uSkyColor: u.uSkyColor, uGroundColor: u.uGroundColor, uTime: u.uTime, uWind: u.uWind,
      uFogColor: u.uFogColor, uFogDensity: u.uFogDensity, uSunDir: u.uSunDir, uSunColor: u.uSunColor,
    },
    vertexShader: treeVert,
    fragmentShader: treeFrag,
  });
  const mesh = new THREE.InstancedMesh(merged, mat, count);
  const tints = new Float32Array(count * 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let placed = 0, guard = 0;
  while (placed < count && guard++ < 5000) {
    // scatter across the back half, in loose clumps, well away from the hilltop
    const ang = -Math.PI / 2 + (rand() * 2 - 1) * 1.35;
    const r = 30 + Math.pow(rand(), 1.3) * 95;
    const x = Math.cos(ang) * r + (rand() - 0.5) * 6, z = Math.sin(ang) * r + (rand() - 0.5) * 6;
    if (Math.abs(x) < 5 + r * 0.1 && rand() < 0.8) continue; // keep the view behind Lumi open
    const size = (1.5 + rand() * 1.6) * (1 + r * 0.006);
    p.set(x, terrainHeight(x, z) - 0.15, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
    s.set(size * (0.85 + rand() * 0.4), size * (0.85 + rand() * 0.45), size * (0.85 + rand() * 0.4));
    mesh.setMatrixAt(placed, m.compose(p, q, s));
    const g = 0.75 + rand() * 0.4;
    tints.set([0.42 * g + rand() * 0.14, 0.72 * g, 0.36 * g + rand() * 0.08], placed * 3);
    placed++;
  }
  mesh.count = placed;
  merged.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.name = 'trees';
  return mesh;
}

function mergeParts(geos, parts) {
  const pos = [], nor = [], part = [];
  geos.forEach((g, gi) => {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...ng.attributes.position.array);
    nor.push(...ng.attributes.normal.array);
    for (let i = 0; i < ng.attributes.position.count; i++) part.push(parts[gi]);
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  return out;
}
