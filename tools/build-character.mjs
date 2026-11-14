// Sculpts Lumi from signed-distance parts and bakes everything the runtime
// needs into app/assets/lumi.bin:
//   positions, normals, skin weights, colour masks, fur length, ambient
//   occlusion, translucency, morph weights, skeleton, eye frames, colliders.
//
//   node tools/build-character.mjs [--cell 0.011]
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { smin, smax, smoothstep, clamp } from './character/sdf.mjs';
import { surfaceNets } from './character/mesher.mjs';
import {
  buildParts, buildBones, buildColliders, buildAnchors,
  whiteMask, jawMask, cheekMask, breathMask, faceMask, EYE, MOUTH,
} from './character/design.mjs';

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const CELL = Number(argOf('cell', 0.011));
const OUT = fileURLToPath(new URL('../app/assets/lumi.bin', import.meta.url));

function makeMap(parts) {
  const adds = parts.filter((p) => p.op === 'add');
  const subs = parts.filter((p) => p.op === 'sub');
  return (x, y, z) => {
    let d = 1e9;
    for (let i = 0; i < adds.length; i++) {
      const p = adds[i], b = p.sdf.bound;
      const dx = x - b.c[0], dy = y - b.c[1], dz = z - b.c[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) - b.r > d + p.k) continue;
      d = smin(d, p.sdf(x, y, z), p.k);
    }
    for (let i = 0; i < subs.length; i++) {
      const p = subs[i], b = p.sdf.bound;
      const dx = x - b.c[0], dy = y - b.c[1], dz = z - b.c[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) - b.r + d > p.k) continue;
      d = smax(d, -p.sdf(x, y, z), p.k);
    }
    return d;
  };
}

function gradientOf(map, p, e = 0.003) {
  const g = [
    map(p[0] + e, p[1], p[2]) - map(p[0] - e, p[1], p[2]),
    map(p[0], p[1] + e, p[2]) - map(p[0], p[1] - e, p[2]),
    map(p[0], p[1], p[2] + e) - map(p[0], p[1], p[2] - e),
  ];
  const l = Math.hypot(...g) || 1;
  return [g[0] / l, g[1] / l, g[2] / l];
}

/** Walk from in front of the face straight back until we hit the surface. */
function surfaceFromFront(map, x, y) {
  let z = 0.7;
  while (z > -0.2 && map(x, y, z) > 0) z -= 0.002;
  let lo = z, hi = z + 0.002;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (map(x, y, mid) > 0) hi = mid; else lo = mid;
  }
  return [x, y, (lo + hi) / 2];
}

const t0 = performance.now();

// ---- pass 1: find where the eyes and mouth sit on the un-socketed head ------
const parts0 = buildParts(null);
const map0 = makeMap(parts0);
const eyeFrames = ['L', 'R'].map((side) => {
  const sx = side === 'L' ? 1 : -1;
  const surface = surfaceFromFront(map0, sx * EYE.x, EYE.y);
  let n = gradientOf(map0, surface, 0.02); // wide stencil: the average facing of the patch
  // soften the outward splay a little so the eyes read as looking forward
  n = [n[0] * 0.8, n[1] * 0.6, n[2]];
  const nl = Math.hypot(...n);
  n = n.map((v) => v / nl);
  // up = world up made orthogonal to n ; right = up x n
  let up = [0, 1, 0];
  const d = up[0] * n[0] + up[1] * n[1] + up[2] * n[2];
  up = [up[0] - n[0] * d, up[1] - n[1] * d, up[2] - n[2] * d];
  const ul = Math.hypot(...up);
  up = up.map((v) => v / ul);
  const right = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
  // row-major local->world matrix whose columns are (right, up, normal)
  const rot = [right[0], up[0], n[0], right[1], up[1], n[1], right[2], up[2], n[2]];
  return { side, surface, normal: n, up, right, rot };
});
const mouthPoint = surfaceFromFront(map0, 0, MOUTH.y);
const starPoint = surfaceFromFront(map0, 0, 0.9);

// ---- pass 2: the real thing ---------------------------------------------------
const parts = buildParts(eyeFrames);
const map = makeMap(parts);
const bones = buildBones(parts);
const boneIndex = Object.fromEntries(bones.map((b, i) => [b[0], i]));

const bounds = { min: [-0.62, -0.06, -0.62], max: [0.62, 1.52, 0.5] };
// keep the grid symmetric about x = 0 so both halves mesh identically
const half = Math.ceil(0.62 / CELL) * CELL;
bounds.min[0] = -half - CELL / 2;
bounds.max[0] = half + CELL / 2;

const mesh = surfaceNets(map, bounds, CELL);
const { positions, normals, indices } = mesh;
const count = positions.length / 3;
const tMesh = performance.now();

// ---- per-vertex attributes ------------------------------------------------------
const adds = parts.filter((p) => p.op === 'add');
const subs = parts.filter((p) => p.op === 'sub');
const skinIndex = new Uint8Array(count * 4);
const skinWeight = new Uint8Array(count * 4);
const aMask = new Uint8Array(count * 4); // white, accent, inner-ear pink, nose
const aFur = new Uint8Array(count * 4); // fur length/2, AO, thinness, face
const aMorph = new Uint8Array(count * 4); // cheek puff, breath, eye proximity, sole of foot
const normalsI8 = new Int8Array(count * 4);

const dists = new Float32Array(adds.length);
const ts = new Float32Array(adds.length);
const bw = new Float32Array(bones.length);
const byte = (v) => Math.round(clamp(v, 0, 1) * 255);
const groundedMap = (x, y, z) => Math.min(map(x, y, z), y + 0.012);

let aoMin = 1, aoSum = 0;
for (let v = 0; v < count; v++) {
  const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
  const n = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];

  let dmin = 1e9;
  for (let i = 0; i < adds.length; i++) {
    const d = adds[i].sdf(p[0], p[1], p[2]);
    dists[i] = d;
    ts[i] = adds[i].sdf.t || 0;
    if (d < dmin) dmin = d;
  }
  bw.fill(0);
  let wSum = 0, fur = 0, accent = 0, nose = 0, headW = 0, foot = 0;
  for (let i = 0; i < adds.length; i++) {
    const part = adds[i];
    let w = 1 - clamp((dists[i] - dmin) / part.reach, 0, 1);
    w *= w;
    if (w <= 0) continue;
    wSum += w;
    fur += w * part.fur;
    if (part.accent) accent += w * part.accent(ts[i]);
    if (part.nose) nose += w;
    if (part.name.startsWith('foot')) foot += w;
    if (part.bone) {
      bw[boneIndex[part.bone]] += w;
    } else {
      // chain: split the weight between neighbouring chain bones around each joint
      const t = ts[i], nb = part.bones.length;
      const blend = part.blend ?? 0.11;
      let prev = 1;
      for (let j = 0; j < nb; j++) {
        const next = j + 1 < nb ? smoothstep(part.bones[j + 1][1] - blend, part.bones[j + 1][1] + blend, t) : 0;
        bw[boneIndex[part.bones[j][0]]] += w * (prev - next);
        prev = next;
      }
    }
  }
  fur /= wSum; accent /= wSum; nose /= wSum;
  headW = bw[boneIndex.head] / wSum;

  // jaw borrows from the head
  const jm = jawMask(p);
  if (jm > 0) {
    const hw = bw[boneIndex.head];
    bw[boneIndex.jaw] += hw * jm;
    bw[boneIndex.head] = hw * (1 - jm);
  }

  // top four influences, normalised to bytes that sum to exactly 255
  const top = [];
  for (let b = 0; b < bones.length; b++) if (bw[b] > 0) top.push([b, bw[b]]);
  top.sort((a, b) => b[1] - a[1]);
  top.length = Math.min(top.length, 4);
  const tw = top.reduce((s, e) => s + e[1], 0);
  let used = 0;
  for (let j = 0; j < 4; j++) {
    if (j < top.length) {
      const q = j === 0 ? 0 : Math.round((top[j][1] / tw) * 255);
      skinIndex[v * 4 + j] = top[j][0];
      skinWeight[v * 4 + j] = q;
      used += q;
    }
  }
  skinWeight[v * 4] = 255 - used;

  // carve masks
  let innerEar = 0, eyeNear = 0;
  for (const s of subs) {
    const d = s.sdf(p[0], p[1], p[2]);
    if (s.mask === 'innerEar') innerEar = Math.max(innerEar, smoothstep(0.012, -0.004, d));
    if (s.mask === 'eye') eyeNear = Math.max(eyeNear, smoothstep(0.03, 0.002, d));
  }

  // ambient occlusion: how much the surroundings (and the ground) close in
  let occ = 0, ow = 0;
  for (let i = 1; i <= 5; i++) {
    const h = 0.012 * Math.pow(1.9, i);
    const d = groundedMap(p[0] + n[0] * h, p[1] + n[1] * h + h * 0.25, p[2] + n[2] * h);
    const wgt = 1 / i;
    occ += clamp((h - d) / h, 0, 1) * wgt;
    ow += wgt;
  }
  const ao = clamp(1 - 1.25 * (occ / ow), 0, 1);
  aoMin = Math.min(aoMin, ao); aoSum += ao;

  // thinness: how soon a ray going inward pops out the far side
  const inner = -map(p[0] - n[0] * 0.05, p[1] - n[1] * 0.05, p[2] - n[2] * 0.05);
  const thin = 1 - clamp(inner / 0.05, 0, 1);

  const white = whiteMask(p, n) * (1 - accent);
  const face = faceMask(p, n, headW);
  const furLen = fur * (1 - 0.92 * eyeNear) * (1 - 0.72 * innerEar) * (1 - nose);

  aMask[v * 4] = byte(white);
  aMask[v * 4 + 1] = byte(accent);
  aMask[v * 4 + 2] = byte(innerEar);
  aMask[v * 4 + 3] = byte(nose);
  aFur[v * 4] = byte(furLen / 2);
  aFur[v * 4 + 1] = byte(ao);
  aFur[v * 4 + 2] = byte(thin);
  aFur[v * 4 + 3] = byte(face);
  aMorph[v * 4] = byte(cheekMask(p) * headW);
  aMorph[v * 4 + 1] = byte(breathMask(p) * (1 - headW));
  aMorph[v * 4 + 2] = byte(eyeNear);
  // soles of the feet (they face down at rest): where the paw pads are drawn
  aMorph[v * 4 + 3] = byte((foot / wSum) * smoothstep(-0.3, -0.7, n[1]));
  normalsI8[v * 4] = Math.round(n[0] * 127);
  normalsI8[v * 4 + 1] = Math.round(n[1] * 127);
  normalsI8[v * 4 + 2] = Math.round(n[2] * 127);
}

// ---- pack ---------------------------------------------------------------------------
const useU16 = count < 65536;
const indexArr = useU16 ? new Uint16Array(indices) : indices;
const buffers = [];
let offset = 0;
const push = (typed) => {
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  const start = offset;
  buffers.push(bytes);
  offset += bytes.byteLength;
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { buffers.push(new Uint8Array(pad)); offset += pad; }
  return start;
};
const attr = (name, typed, type, itemSize, normalized = false) => ({
  name, type, itemSize, normalized, offset: push(typed), count: typed.length / itemSize,
});

let bbMin = [1e9, 1e9, 1e9], bbMax = [-1e9, -1e9, -1e9];
for (let v = 0; v < count; v++) {
  for (let a = 0; a < 3; a++) {
    bbMin[a] = Math.min(bbMin[a], positions[v * 3 + a]);
    bbMax[a] = Math.max(bbMax[a], positions[v * 3 + a]);
  }
}

const header = {
  version: 1,
  vertexCount: count,
  triangleCount: indices.length / 3,
  bbox: { min: bbMin, max: bbMax },
  attributes: [
    attr('position', positions, 'f32', 3),
    attr('normal', normalsI8, 'i8', 4, true),
    attr('skinIndex', skinIndex, 'u8', 4),
    attr('skinWeight', skinWeight, 'u8', 4, true),
    attr('aMask', aMask, 'u8', 4, true),
    attr('aFur', aFur, 'u8', 4, true),
    attr('aMorph', aMorph, 'u8', 4, true),
  ],
  index: { type: useU16 ? 'u16' : 'u32', offset: push(indexArr), count: indexArr.length },
  bones: bones.map(([name, parent, pos]) => ({ name, parent, pos: pos.map((x) => +x.toFixed(5)) })),
  eyes: eyeFrames.map((f) => ({
    side: f.side,
    // the eyeball centre sits a little under the skin so a dome pokes out of the socket
    center: [0, 1, 2].map((a) => +(f.surface[a] - f.normal[a] * (EYE.depth - 0.024)).toFixed(5)),
    right: f.right.map((x) => +x.toFixed(5)),
    up: f.up.map((x) => +x.toFixed(5)),
    normal: f.normal.map((x) => +x.toFixed(5)),
    radii: [EYE.rx, EYE.ry, EYE.depth],
  })),
  mouth: { center: mouthPoint.map((x) => +x.toFixed(5)) },
  star: { center: starPoint.map((x) => +x.toFixed(5)) },
  colliders: buildColliders(parts),
  anchors: buildAnchors(parts, mouthPoint, starPoint),
};

const headerBytes = new TextEncoder().encode(JSON.stringify(header));
const headerPad = (4 - (headerBytes.length % 4)) % 4;
const total = 8 + headerBytes.length + headerPad + offset;
const out = new Uint8Array(total);
const dv = new DataView(out.buffer);
dv.setUint32(0, 0x494d554c, true); // "LUMI"
dv.setUint32(4, headerBytes.length + headerPad, true);
out.set(headerBytes, 8);
out.fill(0x20, 8 + headerBytes.length, 8 + headerBytes.length + headerPad); // pad with spaces (valid JSON whitespace)
let o = 8 + headerBytes.length + headerPad;
for (const b of buffers) { out.set(b, o); o += b.byteLength; }

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);

console.log(`grid ${mesh.grid.join('x')} cell ${CELL}`);
console.log(`vertices ${count}  triangles ${indices.length / 3}`);
console.log(`bbox min ${bbMin.map((x) => x.toFixed(3))} max ${bbMax.map((x) => x.toFixed(3))}`);
console.log(`eyes at ${eyeFrames.map((f) => f.surface.map((x) => x.toFixed(3)).join(',')).join(' | ')} normal ${eyeFrames[0].normal.map((x) => x.toFixed(2))}`);
console.log(`mouth ${mouthPoint.map((x) => x.toFixed(3))}  star ${starPoint.map((x) => x.toFixed(3))}`);
console.log(`ao min ${aoMin.toFixed(2)} mean ${(aoSum / count).toFixed(2)}`);
console.log(`mesh ${(tMesh - t0).toFixed(0)}ms, attributes ${(performance.now() - tMesh).toFixed(0)}ms`);
console.log(`wrote ${OUT} (${(total / 1024).toFixed(0)} KB)`);
