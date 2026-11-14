// Lumi's coat: a skinned "shell fur" material. The same shader draws the skin
// (uShell = 0) and every fur layer above it (uShell in (0, 1]); each layer is
// the mesh pushed outward along its normals with strands punched out, which
// together read as soft, deep fur. Face details (mouth, blush, brows, the
// forehead star) are drawn procedurally in the head's rest space so they can
// animate smoothly and stay razor sharp at any resolution.
import * as THREE from 'three';
import { SHADOW_PICK_GLSL } from '../world/terrain.js';

const vertexShader = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>

attribute vec4 aMask;
attribute vec4 aFur;
attribute vec4 aMorph;

uniform float uShell;
uniform float uFurLength;
uniform vec3 uFurSway;
uniform float uCheekPuff;
uniform float uBreath;

varying vec3 vRest;
varying vec3 vWorldPos;
varying vec3 vWorldN;
varying vec4 vMask;
varying vec4 vFur;
varying float vEyeNear;
varying float vSole;

void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>

  vec3 transformed = position;
  // soft-body morphs, applied in rest space
  transformed += normal * (aMorph.x * uCheekPuff * 0.045 + aMorph.y * uBreath * 0.012);
  #include <skinning_vertex>

  vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
  vec3 wn = normalize(mat3(modelMatrix) * objectNormal);

  // fur layer offset: straight out, then the tips droop and sway
  float len = uFurLength * aFur.x * 2.0;
  float h = uShell;
  vec3 push = vec3(0.0, -0.42, 0.0) + uFurSway;
  push -= wn * dot(push, wn) * 0.75;
  worldPosition.xyz += wn * (len * h) + push * (len * h * h);

  vRest = position;
  vWorldPos = worldPosition.xyz;
  vWorldN = wn;
  vMask = aMask;
  vFur = aFur;
  vEyeNear = aMorph.z;
  vSole = aMorph.w;

  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <shadowmap_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
${SHADOW_PICK_GLSL}

uniform float uShell;
uniform float uDensity;
uniform float uTime;

uniform vec3 uColBase;
uniform vec3 uColWhite;
uniform vec3 uColAccentA;
uniform vec3 uColAccentB;
uniform vec3 uColPink;
uniform vec3 uColNose;

uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uRimDir;
uniform vec3 uRimColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform float uExposure;

// face
uniform vec3 uMouthCenter;   // rest space
uniform vec4 uMouth;         // open, wide, smile, pout
uniform float uTongue;       // tongue poking out 0..1
uniform vec3 uStarCenter;
uniform float uStarGlow;
uniform float uBlush;
uniform vec4 uBrow;          // raiseL, raiseR, tiltL, tiltR
uniform vec2 uEyeXY;         // |x|, y of the eye centres in rest space

varying vec3 vRest;
varying vec3 vWorldPos;
varying vec3 vWorldN;
varying vec4 vMask;
varying vec4 vFur;
varying float vEyeNear;
varying float vSole;

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

// ---- mouth ---------------------------------------------------------------
// Mouth space: origin where the two lip arcs meet under the nose, 1 unit = 10 cm.
// Returns x: signed distance to the open interior (<0 inside), y: distance to the lip line,
// z: tongue mask, w: depth shading inside the mouth.
vec4 mouthField(vec2 m) {
  float open = uMouth.x, wide = uMouth.y, smile = uMouth.z, pout = uMouth.w;
  float w = 0.40 * (1.0 + 0.32 * wide) * (1.0 - 0.45 * pout);
  float ax = abs(m.x);
  float u = clamp(ax / w, 0.0, 1.0);
  // upper lip: a soft "w" whose corners lift with a smile
  float dip = 0.105 * (1.0 - 0.6 * open) * (1.0 - 0.5 * pout);
  float lift = 0.17 * smile;
  float base = lift * u * u;
  float upper = base - dip * sin(PI * u);
  float dUpper = (2.0 * lift * u - dip * PI * cos(PI * u)) / w;
  float cornerY = lift;
  // lower lip: hangs from the corners; hugs the upper lip while barely open
  float drop = open * 0.52;
  float bowl = sqrt(max(1.0 - u * u, 0.0));
  float lower = mix(upper, base, smoothstep(0.0, 0.45, open)) - drop * bowl;

  float dLine = abs(m.y - upper) / sqrt(1.0 + dUpper * dUpper);
  if (ax > w) dLine = length(vec2(ax - w, m.y - cornerY));
  float inside = max(max(m.y - upper, lower - m.y), ax - w);
  if (open > 0.02 && ax < w) dLine = min(dLine, abs(m.y - lower) + 0.012);

  // tongue: a rounded mound resting on the lower lip
  vec2 tq = (m - vec2(0.0, lower + drop * 0.2)) / vec2(w * 0.62, max(drop * 0.5, 0.001));
  float tongue = (1.0 - smoothstep(0.8, 1.0, length(tq))) * step(0.02, open);
  // "blep": the tip of the tongue peeking out under the upper lip
  if (uTongue > 0.01) {
    float blep = length((m - vec2(0.0, -0.035 - 0.07 * uTongue)) / vec2(0.115, 0.03 + 0.1 * uTongue)) - 1.0;
    blep = max(blep * 0.08, m.y - upper);
    tongue = max(tongue, 1.0 - smoothstep(-0.01, 0.0, blep));
    inside = min(inside, blep);
  }
  float depth = clamp((upper - m.y) / max(drop, 0.001), 0.0, 1.0);
  return vec4(inside, dLine, tongue, depth);
}

void main() {
  vec3 N = normalize(vWorldN);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float h = uShell;
  float furLen = vFur.x * 2.0;
  float face = vFur.w;

  // ---- paw pads: one big bean and three little toe beans on each sole ---------
  float pad = 0.0;
  if (vSole > 0.25) {
    vec2 s = vec2(abs(vRest.x) - 0.142, vRest.z - 0.09);
    s = vec2(s.x * 0.974 - s.y * 0.225, s.x * 0.225 + s.y * 0.974); // feet point slightly outward
    float d = length((s - vec2(0.0, -0.02)) / vec2(0.04, 0.034));
    d = min(d, length((s - vec2(-0.036, 0.04)) / vec2(0.0165, 0.0185)));
    d = min(d, length((s - vec2(0.0, 0.052)) / vec2(0.0165, 0.0185)));
    d = min(d, length((s - vec2(0.036, 0.04)) / vec2(0.0165, 0.0185)));
    pad = (1.0 - smoothstep(0.85, 1.0, d)) * smoothstep(0.25, 0.6, vSole);
    if (uShell > 0.0 && pad > 0.5) discard;
  }

  // ---- strands -------------------------------------------------------------
  vec3 strandRnd = vec3(0.5);
  if (h > 0.0) {
    if (furLen < 0.03) discard;
    vec3 q = vRest * uDensity;
    vec3 cell = floor(q);
    vec3 f = fract(q) - 0.5;
    strandRnd = hash33(cell);
    float d = length(f - (strandRnd - 0.5) * 0.75);
    float strandLen = 0.5 + 0.5 * strandRnd.x;
    float hh = h / strandLen;
    float radius = 0.78 * (1.0 - hh * hh);
    if (hh > 1.0 || d > radius) discard;
    // toward the tips each tuft splits into finer hairs
    if (h > 0.34) {
      vec3 q2 = vRest * uDensity * 2.3 + 17.0;
      vec3 r2 = hash33(floor(q2));
      float d2 = length(fract(q2) - 0.5 - (r2 - 0.5) * 0.7);
      float fine = mix(0.95, 0.42, smoothstep(0.34, 1.0, h)) * (0.75 + 0.5 * r2.y);
      if (d2 > fine) discard;
      strandRnd = mix(strandRnd, r2, 0.5);
    }
  }

  // ---- colour --------------------------------------------------------------
  vec3 albedo = mix(uColBase, uColWhite, vMask.x);
  vec3 accent = mix(uColAccentA, uColAccentB, smoothstep(0.5, 1.0, vMask.y));
  albedo = mix(albedo, accent, smoothstep(0.0, 0.9, vMask.y));
  albedo = mix(albedo, uColPink, vMask.z * 0.92);
  albedo *= 0.94 + 0.12 * vnoise(vRest * 9.0);
  vec3 emissive = vec3(0.0);
  float gloss = vMask.w;

  if (face > 0.01) {
    // blush
    vec2 bq = (vec2(abs(vRest.x), vRest.y) - vec2(uEyeXY.x + 0.105, uEyeXY.y - 0.115)) / vec2(0.07, 0.042);
    float blush = (1.0 - smoothstep(0.35, 1.0, length(bq))) * face;
    albedo = mix(albedo, vec3(1.0, 0.42, 0.5), blush * (0.5 + 0.5 * uBlush));

    // brows: two soft dabs above the eyes
    float side = vRest.x > 0.0 ? 0.0 : 1.0;
    float raise = mix(uBrow.x, uBrow.y, side);
    float tilt = mix(uBrow.z, uBrow.w, side);
    vec2 bc = vec2(uEyeXY.x - 0.012, uEyeXY.y + 0.137 + raise * 0.03);
    vec2 bp = vec2(abs(vRest.x), vRest.y) - bc;
    float ca = cos(tilt), sa = sin(tilt);
    bp = vec2(ca * bp.x + sa * bp.y, -sa * bp.x + ca * bp.y);
    float brow = 1.0 - smoothstep(0.7, 1.0, length(bp / vec2(0.034, 0.0125)));
    albedo = mix(albedo, uColAccentA * 0.85, brow * face * 0.9);

    // forehead star
    vec2 sp = (vRest.xy - uStarCenter.xy) / vec2(0.042, 0.054);
    float star = pow(abs(sp.x), 0.62) + pow(abs(sp.y), 0.62);
    float starMask = (1.0 - smoothstep(0.86, 1.0, star)) * face;
    vec3 gold = vec3(1.0, 0.74, 0.22);
    albedo = mix(albedo, gold, starMask);
    emissive += gold * starMask * (0.25 + 2.6 * uStarGlow);
    emissive += gold * (1.0 - smoothstep(0.0, 2.6, star)) * face * uStarGlow * 0.35;

    // mouth
    vec2 m = (vRest.xy - uMouthCenter.xy) * 7.6;
    if (abs(m.x) < 1.2 && abs(m.y + 0.3) < 1.2) {
      vec4 mf = mouthField(m);
      float aa = 0.02;
      float inside = (1.0 - smoothstep(-aa, aa, mf.x)) * step(0.02, max(uMouth.x, uTongue)) * face;
      if (h > 0.0 && inside > 0.5) discard;
      vec3 cavity = mix(vec3(0.16, 0.03, 0.06), vec3(0.42, 0.1, 0.14), mf.w);
      vec3 tongueCol = vec3(1.0, 0.47, 0.5) * (0.82 + 0.18 * (1.0 - mf.w));
      cavity = mix(cavity, tongueCol, mf.z);
      albedo = mix(albedo, cavity, inside);
      gloss = max(gloss, inside * mf.z * 0.5);
      float line = (1.0 - smoothstep(0.022, 0.05, mf.y)) * face;
      // the little crease from the nose down to the lips
      float philtrum = (1.0 - smoothstep(0.016, 0.04, abs(m.x))) * step(0.0, m.y) * (1.0 - smoothstep(0.3, 0.42, m.y));
      line = max(line, philtrum * face) * (1.0 - inside);
      albedo = mix(albedo, vec3(0.36, 0.14, 0.17), line * 0.92);
    }
  }
  albedo = mix(albedo, uColNose, vMask.w);
  albedo = mix(albedo, uColPink * vec3(1.0, 0.86, 0.9), pad);
  gloss = max(gloss, pad * 0.35);

  // ---- light ----------------------------------------------------------------
  float ao = vFur.y;
  float furry = smoothstep(0.0, 0.25, furLen);
  // fur gets darker toward the roots where strands shade each other
  float rootShade = h > 0.0 ? mix(0.5, 1.0, pow(h, 0.7)) : mix(1.0, 0.46, furry * (1.0 - pad));
  vec3 tint = h > 0.0 ? mix(vec3(1.0), vec3(1.04, 1.02, 0.98), h) * (0.93 + 0.14 * strandRnd.y) : vec3(1.0);

  float ndl = dot(N, uKeyDir);
  float wrap = mix(0.25, 0.55, furry);
  float diffuse = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
  float shadow = mix(1.0, shadowFrom(0), 0.6);
  vec3 light = uKeyColor * diffuse * shadow;

  float hemi = N.y * 0.5 + 0.5;
  vec3 ambient = mix(uGroundColor, uSkyColor, hemi) * mix(0.35, 1.0, ao);

  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4);
  float rimFacing = clamp(dot(N, uRimDir) * 0.6 + 0.5, 0.0, 1.0);
  vec3 rim = uRimColor * fres * rimFacing * mix(0.3, 1.0, h) * mix(0.5, 1.0, ao) * 0.55;

  // light bleeding through thin parts (ears) when lit from behind
  float through = vFur.z * clamp(dot(-N, uRimDir) * 0.5 + 0.5, 0.0, 1.0);
  vec3 sss = uRimColor * vec3(1.0, 0.55, 0.5) * through * 0.35;

  vec3 col = albedo * tint * (light + ambient) * rootShade + albedo * (rim + sss);

  // wet nose / tongue highlight
  vec3 H = normalize(uKeyDir + V);
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 90.0) * gloss;
  col += uKeyColor * spec * 0.9;
  // a soft sheen across the tips of the coat
  float sheen = pow(1.0 - abs(dot(N, H)), 5.0) * furry * h;
  col += uKeyColor * albedo * sheen * 0.12;

  col += emissive;
  gl_FragColor = vec4(col * uExposure, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const lin = (hex) => new THREE.Color(hex); // THREE.Color converts sRGB hex to linear working space

/** Uniforms shared by the skin and every fur layer. `env` supplies the world's light. */
export function createFurUniforms(header, env) {
  const eye = header.eyes[0];
  const e = env.uniforms;
  return {
    uFurLength: { value: 0.046 },
    uDensity: { value: 230 },
    uFurSway: { value: new THREE.Vector3() },
    uCheekPuff: { value: 0 },
    uBreath: { value: 0 },
    uTime: e.uTime,
    uExposure: e.uExposure,

    uColBase: { value: lin(0xfff4e6) },
    uColWhite: { value: lin(0xfffdf8) },
    uColAccentA: { value: lin(0xe9defe) },
    uColAccentB: { value: lin(0xc9b3f9) },
    uColPink: { value: lin(0xffbfc9) },
    uColNose: { value: lin(0x7a3f4a) },

    uKeyDir: e.uKeyDir,
    uKeyColor: e.uKeyColor,
    uRimDir: e.uRimDir,
    uRimColor: e.uRimColor,
    uSkyColor: e.uSkyColor,
    uGroundColor: e.uGroundColor,

    uMouthCenter: { value: new THREE.Vector3(...header.mouth.center) },
    uMouth: { value: new THREE.Vector4(0, 0, 0.5, 0) },
    uTongue: { value: 0 },
    uStarCenter: { value: new THREE.Vector3(...header.star.center) },
    uStarGlow: { value: 0 },
    uBlush: { value: 0 },
    uBrow: { value: new THREE.Vector4(0, 0, 0, 0) },
    uEyeXY: { value: new THREE.Vector2(Math.abs(eye.center[0]), eye.center[1]) },
  };
}

/**
 * @param shared uniforms from createFurUniforms
 * @param shell 0 for the skin, (0..1] for a fur layer
 */
export function createFurMaterial(shared, shell) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      ...shared,
      uShell: { value: shell },
    },
    vertexShader,
    fragmentShader,
    lights: true,
  });
  material.name = shell === 0 ? 'lumi-skin' : 'lumi-fur';
  return material;
}
