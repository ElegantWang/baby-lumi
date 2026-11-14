import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAsset } from './helpers.mjs';
import { surfaceNets } from '../tools/character/mesher.mjs';
import { sphere, smin, ellipsoid, chain } from '../tools/character/sdf.mjs';

test('mesher turns a sphere SDF into a closed, outward-facing mesh on the surface', () => {
  const r = 0.4;
  const f = sphere([0, 0, 0], r);
  const m = surfaceNets(f, { min: [-0.6, -0.6, -0.6], max: [0.6, 0.6, 0.6] }, 0.05);
  const n = m.positions.length / 3;
  assert.ok(n > 300, `expected a few hundred vertices, got ${n}`);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = m.positions.subarray(i * 3, i * 3 + 3);
    const len = Math.hypot(x, y, z);
    assert.ok(Math.abs(len - r) < 0.004, `vertex ${i} is ${len} from the centre`);
    const dot = (m.normals[i * 3] * x + m.normals[i * 3 + 1] * y + m.normals[i * 3 + 2] * z) / len;
    assert.ok(dot > 0.99, 'normal points outward');
  }
  // watertight: every edge is shared by exactly two triangles, in opposite directions
  const edges = new Map();
  for (let t = 0; t < m.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = m.indices[t + e], b = m.indices[t + ((e + 1) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      edges.set(key, (edges.get(key) || 0) + (a < b ? 1 : -1));
    }
  }
  for (const [key, balance] of edges) assert.equal(balance, 0, `edge ${key} is not shared by two opposite triangles`);
});

test('smooth union blends two shapes without leaving the hull of either', () => {
  assert.equal(smin(1, 2, 0), 1);
  assert.ok(smin(1, 1, 0.5) < 1, 'equal distances blend below the minimum');
  assert.equal(smin(1, 5, 0.5), 1, 'far apart: plain minimum');
  const e = ellipsoid([0, 0, 0], [1, 2, 3]);
  assert.ok(Math.abs(e(1, 0, 0)) < 1e-6 && Math.abs(e(0, 2, 0)) < 1e-6 && Math.abs(e(0, 0, 3)) < 1e-6);
  assert.ok(e(0, 0, 0) < 0 && e(2, 0, 0) > 0);
});

test('tube primitive reports where along its length the closest point lies', () => {
  const c = chain({ pts: [[0, 0, 0], [0, 1, 0], [0, 2, 0]], radii: [0.2, 0.2, 0.2] });
  assert.ok(Math.abs(c(0.2, 1, 0)) < 1e-3);
  c(0.5, 0.5, 0);
  assert.ok(Math.abs(c.t - 0.25) < 0.02);
  c(0.5, 2.5, 0);
  assert.ok(c.t > 0.98);
});

test('the baked character asset is complete and consistent', () => {
  const { magic, header, attributes, index } = loadAsset();
  assert.equal(magic, 0x494d554c);
  const n = header.vertexCount;
  assert.ok(n > 10000 && n < 65536, `vertex count ${n}`);
  assert.equal(index.length, header.triangleCount * 3);
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight', 'aMask', 'aFur', 'aMorph']) assert.ok(attributes[name], `missing ${name}`);
  for (let i = 0; i < index.length; i++) assert.ok(index[i] < n);
  const bones = header.bones.length;
  for (let v = 0; v < n; v++) {
    let sum = 0;
    for (let j = 0; j < 4; j++) {
      sum += attributes.skinWeight[v * 4 + j];
      assert.ok(attributes.skinIndex[v * 4 + j] < bones);
    }
    assert.equal(sum, 255, `skin weights of vertex ${v} sum to ${sum}`);
  }
  const names = header.bones.map((b) => b.name);
  for (const b of header.bones) if (b.parent) assert.ok(names.includes(b.parent), `${b.name} has unknown parent`);
  assert.equal(header.eyes.length, 2);
  // left and right eyes mirror each other
  assert.ok(Math.abs(header.eyes[0].center[0] + header.eyes[1].center[0]) < 1e-4);
  for (const c of header.colliders) assert.ok(names.includes(c.bone));
  for (const a of Object.values(header.anchors)) assert.ok(names.includes(a.bone));
  // she stands on the ground and is about a metre tall to the top of her head
  assert.ok(header.bbox.min[1] > -0.03 && header.bbox.min[1] < 0.03);
  assert.ok(header.bbox.max[1] > 1.3 && header.bbox.max[1] < 1.5);
});
