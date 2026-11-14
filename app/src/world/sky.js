// Sky dome: gradient, sun glow, drifting clouds, and stars + moon at night.
import * as THREE from 'three';
import { WORLD_GLSL } from './atmosphere.js';

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww; // pinned to the far plane
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uStars;
uniform float uSunDisc;
uniform float uMoon;
uniform float uTime;
varying vec3 vDir;
${WORLD_GLSL}
float hash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
void main() {
  vec3 dir = normalize(vDir);
  float h = max(dir.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.6, h), 0.6));

  float sd = max(dot(dir, uSunDir), 0.0);
  // wide warm glow around the sun (or cool glow around the moon)
  col += uSunColor * (pow(sd, 6.0) * 0.16 + pow(sd, 40.0) * 0.4);
  // the disc itself
  float disc = smoothstep(0.9993, 0.99975, sd);
  col += uSunColor * disc * 9.0 * uSunDisc;
  float moon = smoothstep(0.9988, 0.9992, sd);
  // a soft crescent: subtract an offset disc
  vec3 off = normalize(uSunDir + vec3(0.016, 0.012, 0.0));
  moon *= 1.0 - smoothstep(0.9989, 0.9993, dot(dir, off)) * 0.92;
  col += vec3(0.95, 0.97, 1.0) * moon * 5.0 * uMoon;

  // clouds, projected onto a high plane
  vec2 cuv = dir.xz / (dir.y + 0.16);
  float c = wfbm(cuv * 0.55 + vec2(uTime * 0.006, 0.0));
  float cover = smoothstep(0.5, 0.82, c) * smoothstep(0.015, 0.16, dir.y);
  vec3 cloudLit = mix(uHorizon, vec3(1.0), 0.55) * (1.0 - 0.55 * uStars) + uSunColor * 0.3 * pow(sd, 2.0);
  vec3 cloudShade = mix(uZenith, uHorizon, 0.6) * 0.85;
  float shade = smoothstep(0.55, 0.95, wfbm(cuv * 0.55 + vec2(uTime * 0.006, 0.0) + uSunDir.xz * 0.12));
  col = mix(col, mix(cloudLit, cloudShade, shade * 0.6), cover * 0.9);

  // stars
  if (uStars > 0.01) {
    vec3 g = dir * 150.0;
    vec3 id = floor(g);
    float rnd = hash3(id);
    vec3 f = fract(g) - 0.5;
    float star = smoothstep(0.14, 0.0, length(f)) * step(0.972, rnd);
    float twinkle = 0.65 + 0.35 * sin(uTime * (1.5 + rnd * 4.0) + rnd * 60.0);
    col += vec3(0.85, 0.9, 1.0) * star * twinkle * 2.2 * uStars * (1.0 - cover) * smoothstep(0.0, 0.12, dir.y);
  }

  // haze near and below the horizon
  col = mix(col, uFogColor, smoothstep(0.05, -0.04, dir.y) * 0.85);
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky(env) {
  const u = env.uniforms;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: u.uZenith, uHorizon: u.uHorizon, uStars: u.uStars, uSunDisc: u.uSunDisc, uMoon: u.uMoon, uTime: u.uTime,
      uFogColor: u.uFogColor, uFogDensity: u.uFogDensity, uSunDir: u.uSunDir, uSunColor: u.uSunColor,
    },
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
  });
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  return mesh;
}
