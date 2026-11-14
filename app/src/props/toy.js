// Shared look for small props (snacks etc.): vertex-coloured, lit by the same
// world light as everything else, with a soft rim and a glossy highlight.
import * as THREE from 'three';

const vert = /* glsl */ `
attribute vec3 color;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorldPos;
void main() {
  vColor = color;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const frag = /* glsl */ `
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uRimDir;
uniform vec3 uRimColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform float uGloss;
uniform float uGlow;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorldPos;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float diffuse = clamp((dot(N, uKeyDir) + 0.4) / 1.4, 0.0, 1.0);
  vec3 ambient = mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  vec3 col = vColor * (uKeyColor * diffuse + ambient * 1.1);
  col += vColor * uRimColor * fres * clamp(dot(N, uRimDir) * 0.5 + 0.6, 0.0, 1.0) * 0.4;
  vec3 H = normalize(uKeyDir + V);
  col += uKeyColor * pow(clamp(dot(N, H), 0.0, 1.0), 60.0) * uGloss;
  col += vColor * uGlow;
  gl_FragColor = vec4(col, 1.0);
}`;

export function createToyMaterial(env, gloss = 0.5) {
  const u = env.uniforms;
  return new THREE.ShaderMaterial({
    uniforms: {
      uKeyDir: u.uKeyDir, uKeyColor: u.uKeyColor, uRimDir: u.uRimDir, uRimColor: u.uRimColor,
      uSkyColor: u.uSkyColor, uGroundColor: u.uGroundColor, uGloss: { value: gloss }, uGlow: { value: 0 },
    },
    vertexShader: vert,
    fragmentShader: frag,
  });
}

/** Give a geometry a colour (flat, or computed per vertex) and return it un-indexed. */
export function tinted(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    if (typeof color === 'function') color(c, pos.getX(i), pos.getY(i), pos.getZ(i));
    else c.set(color);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Merge un-indexed, tinted geometries into one. */
export function mergeTinted(geos) {
  const pos = [], nor = [], col = [];
  for (const g of geos) {
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    col.push(...g.attributes.color.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

export const lathe = (pts, seg = 28) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
