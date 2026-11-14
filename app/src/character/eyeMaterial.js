// Lumi's eyes. Each eye is a glassy dome set into a socket; the iris, pupil,
// catch-lights and both eyelids are painted procedurally so they can blink,
// squint, widen, sparkle and follow a finger with no textures at all.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorldPos;
varying vec3 vWorldN;
varying vec3 vViewLocal;
varying vec3 vAxisN;
uniform vec3 uScale;

void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  // the dome is a scaled unit sphere: its normal needs the inverse-transpose scale
  vWorldN = normalize(mat3(modelMatrix) * (position / (uScale * uScale)));
  vAxisN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
  // view direction expressed in the eye's own frame (for the fake refraction)
  vec3 toCam = cameraPosition - wp.xyz;
  mat3 m = mat3(modelMatrix);
  vViewLocal = vec3(dot(normalize(m[0]), toCam), dot(normalize(m[1]), toCam), dot(normalize(m[2]), toCam));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
#include <common>

uniform float uSide;        // +1 for Lumi's left eye, -1 for her right
uniform vec2 uGaze;         // where the iris points, -1..1
uniform float uPupil;       // pupil size relative to the iris
uniform float uLidUpper;    // 0 open .. 1 closed
uniform float uLidLower;    // 0 open .. 1 raised (happy squint)
uniform float uLidTilt;     // + sad / gentle, - determined
uniform float uSparkle;     // star-shaped catch-lights
uniform float uHeart;       // heart-shaped pupils
uniform float uTear;        // welling up
uniform float uTime;

uniform vec3 uIrisA;        // deep colour
uniform vec3 uIrisB;        // bright colour
uniform vec3 uIrisGlow;     // the lit crescent at the bottom of the iris
uniform vec3 uLidColor;

uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uRimDir;
uniform vec3 uRimColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform float uExposure;

varying vec3 vLocal;
varying vec3 vWorldPos;
varying vec3 vWorldN;
varying vec3 vViewLocal;
varying vec3 vAxisN;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  p.y += 0.55;
  if (p.y + p.x > 1.0) return sqrt(dot(p - vec2(0.25, 0.75), p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot(p - vec2(0.0, 1.0), p - vec2(0.0, 1.0)), dot(p - 0.5 * max(p.x + p.y, 0.0), p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
// 4-point sparkle, 0 at centre .. 1 at the edge
float starShape(vec2 p) {
  return pow(abs(p.x), 0.55) + pow(abs(p.y), 0.55);
}

void main() {
  vec2 p = vLocal.xy;                    // unit disc across the eye opening
  vec3 N = normalize(vWorldN);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 vl = normalize(vViewLocal);

  // ---- eyelids ----------------------------------------------------------------
  float edge = sqrt(max(1.0 - p.x * p.x, 0.0)) * 0.97;
  float tilt = uLidTilt * uSide * p.x * 0.35;
  // a fully shut upper lid rests a little above the bottom edge, so its lash line reads as a clear arc
  float lidU = mix(edge, -edge, clamp(uLidUpper, 0.0, 1.0) * 0.8) - tilt * (1.0 - uLidUpper);
  float lidL = mix(-edge, edge, clamp(uLidLower, 0.0, 1.0) * 0.86);
  lidL = min(lidL, lidU);
  float aa = 0.012;
  float openMask = smoothstep(-aa, aa, lidU - p.y) * smoothstep(-aa, aa, p.y - lidL) * (1.0 - smoothstep(0.93, 1.0, uLidUpper));

  // ---- eyeball ------------------------------------------------------------------
  // fake refraction: the iris sits behind the cornea, so it shifts against the view
  vec2 q = p - vl.xy * 0.2;
  vec2 gaze = clamp(uGaze, -1.0, 1.0) * vec2(0.17, 0.13);
  vec2 d = q - gaze;
  float irisR = 0.9;
  float r = length(d) / irisR;
  float ang = atan(d.y, d.x);

  vec3 sclera = vec3(0.93, 0.94, 1.0) * (0.35 + 0.65 * smoothstep(1.0, 0.3, length(p)));
  // iris: radial fibres, bright lower crescent, dark limbal ring
  float fibre = vnoise(vec2(ang * 9.0, r * 5.0)) * 0.6 + vnoise(vec2(ang * 23.0, r * 9.0)) * 0.4;
  vec3 iris = mix(uIrisA, uIrisB, smoothstep(0.25, 0.95, r) * (0.65 + 0.5 * fibre));
  float crescent = smoothstep(0.1, -0.75, d.y / irisR) * smoothstep(0.35, 0.8, r) * (1.0 - smoothstep(0.86, 1.0, r));
  iris += uIrisGlow * crescent * (0.7 + 0.5 * fibre);
  iris *= 1.0 - 0.75 * smoothstep(0.82, 1.0, r);           // limbal ring
  // pupil (round, or a heart when smitten)
  float pr = uPupil;
  float pupil = 1.0 - smoothstep(pr - 0.035, pr + 0.035, r);
  if (uHeart > 0.01) {
    float hd = sdHeart(d / irisR / (0.62 + 0.05 * sin(uTime * 6.0)) * 1.0 + vec2(0.0, 0.0));
    float heart = 1.0 - smoothstep(-0.03, 0.03, hd);
    iris = mix(iris, vec3(1.0, 0.25, 0.45) * 1.25, heart * uHeart);
    pupil *= 1.0 - uHeart;
  }
  iris = mix(iris, vec3(0.012, 0.008, 0.03), pupil);
  vec3 ball = mix(iris, sclera, smoothstep(0.985, 1.02, r));

  // shadow cast by the upper lid and lashes
  float lidShadow = smoothstep(0.0, 0.55, lidU - p.y);
  ball *= mix(0.3, 1.0, lidShadow);
  // simple shading of the ball itself
  float lambert = clamp(dot(N, uKeyDir) * 0.5 + 0.5, 0.0, 1.0);
  ball *= (uKeyColor * lambert * 0.5 + mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5) * 0.9);

  // ---- catch-lights ---------------------------------------------------------------
  vec2 hp = p - vl.xy * 0.06 - gaze * 0.25;
  vec2 h1 = (hp - vec2(-0.3, 0.36)) / 0.25;
  vec2 h2 = (hp - vec2(0.3, -0.34)) / 0.105;
  float c1 = 1.0 - smoothstep(0.78, 1.0, length(h1 * vec2(1.0, 0.9)));
  float c2 = 1.0 - smoothstep(0.7, 1.0, length(h2));
  if (uSparkle > 0.01) {
    float tw = 0.85 + 0.15 * sin(uTime * 9.0);
    float s1 = 1.0 - smoothstep(0.75, 1.0, starShape(h1 * 0.62 / tw));
    float s2 = 1.0 - smoothstep(0.75, 1.0, starShape(h2 * 0.55 * tw));
    vec2 h3 = (hp - vec2(-0.18, -0.42)) / 0.13;
    float s3 = 1.0 - smoothstep(0.75, 1.0, starShape(h3 * 0.7 / tw));
    c1 = mix(c1, s1, uSparkle);
    c2 = mix(c2, max(s2, s3), uSparkle);
  }
  vec3 glints = vec3(1.0) * (c1 * 2.6 + c2 * 1.7);
  // soft reflection of the sky across the top and a fresnel sheen at the edge
  float skyRefl = smoothstep(-0.1, 0.9, hp.y) * 0.13;
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  vec3 refl = uSkyColor * (skyRefl + fres * 0.9) + uRimColor * fres * clamp(dot(N, uRimDir), 0.0, 1.0) * 0.6;
  // glistening tears gather along the lower lid
  float tearLine = smoothstep(0.16, 0.0, p.y - lidL) * (0.18 + uTear * 1.4);
  ball += refl + glints * lidShadow + vec3(0.9, 0.95, 1.0) * tearLine * lidShadow;

  // ---- lids -------------------------------------------------------------------------
  float fuzz = vnoise(p * 42.0) * 0.5 + vnoise(p * 90.0) * 0.5;
  // a closed lid is a soft little mound of the same fur as the face around it
  float mound = smoothstep(1.0, 0.25, length(p));
  vec3 lidAlbedo = uLidColor * vec3(0.93, 0.915, 0.9) * (0.95 + 0.1 * fuzz) * mix(0.93, 1.0, mound);
  // light the lid like the flat patch of face it belongs to, not like a glass ball,
  // so it blends into the surrounding fur from every angle
  vec3 Nl = normalize(mix(N, normalize(vAxisN), 0.8));
  float diffuse = clamp((dot(Nl, uKeyDir) + 0.55) / 1.55, 0.0, 1.0);
  vec3 lid = lidAlbedo * (uKeyColor * diffuse + mix(uGroundColor, uSkyColor, Nl.y * 0.5 + 0.5) * 0.95);
  // lash lines: bolder as the eye closes, so shut eyes read as happy little arcs
  float closing = max(uLidUpper, uLidLower);
  float thick = mix(0.085, 0.125, smoothstep(0.5, 1.0, closing));
  float taper = smoothstep(1.0, 0.78, abs(p.x));
  float lashU = (1.0 - smoothstep(thick * 0.45, thick, abs(p.y - lidU))) * taper;
  float lashL = (1.0 - smoothstep(0.012, 0.045, abs(p.y - lidL))) * 0.5 * taper * (1.0 - smoothstep(0.6, 0.9, uLidUpper));
  float lashes = max(lashU, lashL);
  vec3 lashCol = vec3(0.17, 0.08, 0.15);
  vec3 col = mix(lid, ball, openMask);
  col = mix(col, lashCol, lashes * 0.95);
  // dark rim where the glassy ball meets the socket; it melts away where the lid covers it
  float nearOpen = smoothstep(0.22, 0.0, max(p.y - lidU, lidL - p.y));
  float rim = smoothstep(0.84, 0.97, length(p));
  col = mix(col, lashCol, rim * mix(0.0, 0.92, nearOpen));
  // and where the lid is shut, blend the dome's edge into the surrounding fur
  col = mix(col, lid * 0.92, rim * (1.0 - nearOpen) * 0.6);

  gl_FragColor = vec4(col * uExposure, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createEyeMaterial(shared, side, radii) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uKeyDir: shared.uKeyDir,
      uKeyColor: shared.uKeyColor,
      uRimDir: shared.uRimDir,
      uRimColor: shared.uRimColor,
      uSkyColor: shared.uSkyColor,
      uGroundColor: shared.uGroundColor,
      uExposure: shared.uExposure,
      uTime: shared.uTime,
      uLidColor: shared.uColBase,
      uScale: { value: new THREE.Vector3(...radii) },
      uSide: { value: side },
      uGaze: { value: new THREE.Vector2(0, 0) },
      uPupil: { value: 0.56 },
      uLidUpper: { value: 0 },
      uLidLower: { value: 0 },
      uLidTilt: { value: 0 },
      uSparkle: { value: 0 },
      uHeart: { value: 0 },
      uTear: { value: 0 },
      uIrisA: { value: new THREE.Color(0x24104f) },
      uIrisB: { value: new THREE.Color(0x7d3fd6) },
      uIrisGlow: { value: new THREE.Color(0xff8fd0) },
    },
    vertexShader,
    fragmentShader,
  });
}

/** Unit dome facing +Z. */
export function createEyeGeometry() {
  const geo = new THREE.SphereGeometry(1, 48, 20, 0, Math.PI * 2, 0, Math.PI * 0.5);
  geo.rotateX(Math.PI / 2);
  return geo;
}
