// Signed-distance building blocks used to sculpt the character.
// Every primitive is a closure (x, y, z) => distance with a `.bound` sphere so
// the mesher can skip parts that cannot influence a sample.

export const DEG = Math.PI / 180;

/** Polynomial smooth minimum (k = blend radius). */
export function smin(a, b, k) {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a < b ? a : b) - h * h * k * 0.25;
}

export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const mix = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Rotation matrix (row-major 3x3) for yaw (Y), pitch (X), roll (Z) in degrees: R = Ry * Rx * Rz. */
export function rotYXZ(yaw = 0, pitch = 0, roll = 0) {
  const cy = Math.cos(yaw * DEG), sy = Math.sin(yaw * DEG);
  const cx = Math.cos(pitch * DEG), sx = Math.sin(pitch * DEG);
  const cz = Math.cos(roll * DEG), sz = Math.sin(roll * DEG);
  // Ry * Rx * Rz
  return [
    cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx,
    cx * sz, cx * cz, -sx,
    -sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx,
  ];
}

/** Apply a row-major 3x3 matrix to a vector. */
export function mulM3(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Ellipsoid (optionally rotated). Uses the standard first-order distance estimate. */
export function ellipsoid(c, r, rot = null) {
  const [cx, cy, cz] = c;
  const [rx, ry, rz] = r;
  const irx = 1 / rx, iry = 1 / ry, irz = 1 / rz;
  const irx2 = irx * irx, iry2 = iry * iry, irz2 = irz * irz;
  const minR = Math.min(rx, ry, rz);
  const f = (x, y, z) => {
    let px = x - cx, py = y - cy, pz = z - cz;
    if (rot) {
      // world -> local = R^T * p
      const lx = rot[0] * px + rot[3] * py + rot[6] * pz;
      const ly = rot[1] * px + rot[4] * py + rot[7] * pz;
      const lz = rot[2] * px + rot[5] * py + rot[8] * pz;
      px = lx; py = ly; pz = lz;
    }
    const ax = px * irx, ay = py * iry, az = pz * irz;
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const bx = px * irx2, by = py * iry2, bz = pz * irz2;
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -minR;
  };
  f.bound = { c: [cx, cy, cz], r: Math.max(rx, ry, rz) };
  return f;
}

export function sphere(c, r) {
  const [cx, cy, cz] = c;
  const f = (x, y, z) => {
    const px = x - cx, py = y - cy, pz = z - cz;
    return Math.sqrt(px * px + py * py + pz * pz) - r;
  };
  f.bound = { c: [cx, cy, cz], r };
  return f;
}

/** Catmull-Rom subdivision of control points (and radii) into a smooth polyline. */
function subdivide(pts, radii, perSeg) {
  if (perSeg <= 1 || pts.length < 3) return { pts, radii };
  const P = [], R = [];
  const n = pts.length;
  const at = (i) => pts[clamp(i, 0, n - 1)];
  const rat = (i) => radii[clamp(i, 0, n - 1)];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const r0 = rat(i - 1), r1 = rat(i), r2 = rat(i + 1), r3 = rat(i + 2);
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg, t2 = t * t, t3 = t2 * t;
      const cr = (a, b, c, d) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      P.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]), cr(p0[2], p1[2], p2[2], p3[2])]);
      R.push(Math.max(1e-4, cr(r0, r1, r2, r3)));
    }
  }
  P.push(pts[n - 1]);
  R.push(radii[n - 1]);
  return { pts: P, radii: R };
}

/**
 * A smooth tube through control points with a varying radius. Optional local
 * frame { o, rot, flatten } lets the tube be squashed along its local Z axis
 * (used for the leaf-shaped ears). After each evaluation `f.t` holds the 0..1
 * parameter of the closest point along the tube (used for bone weights and
 * colour gradients).
 */
export function chain({ pts, radii, frame = null, perSeg = 8 }) {
  const sub = subdivide(pts, radii, perSeg);
  const P = sub.pts;
  const n = P.length - 1;
  const o = frame?.o || [0, 0, 0];
  const rot = frame?.rot || null;
  const flatten = frame?.flatten || 1;
  const zs = 1 / flatten;
  const dScale = flatten < 1 ? (1 + flatten) * 0.5 : 1;
  // cumulative length for an arc-length parameter
  const cum = [0];
  for (let i = 0; i < n; i++) {
    cum.push(cum[i] + Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1], P[i + 1][2] - P[i][2]));
  }
  const total = cum[n];
  // Radius as a smooth lookup over arc length. A piecewise-linear radius gives
  // every segment its own surface slope, which shows up as rings in the normals.
  const TABLE = 256;
  let table = new Float32Array(TABLE + 1);
  for (let k = 0, i = 0; k <= TABLE; k++) {
    const target = (k / TABLE) * total;
    while (i < n - 1 && cum[i + 1] < target) i++;
    const h = clamp((target - cum[i]) / Math.max(1e-9, cum[i + 1] - cum[i]), 0, 1);
    table[k] = sub.radii[i] + (sub.radii[i + 1] - sub.radii[i]) * h;
  }
  for (let pass = 0; pass < 6; pass++) {
    const next = new Float32Array(TABLE + 1);
    for (let k = 0; k <= TABLE; k++) {
      const a = table[Math.max(0, k - 1)], b = table[k], c = table[Math.min(TABLE, k + 1)];
      next[k] = (a + 2 * b + c) * 0.25;
    }
    table = next;
  }
  const radiusAt = (t) => {
    const x = clamp(t, 0, 1) * TABLE;
    const i = Math.min(TABLE - 1, Math.floor(x));
    return table[i] + (table[i + 1] - table[i]) * (x - i);
  };
  const R = P.map((_, i) => radiusAt(cum[i] / total));
  const f = (x, y, z) => {
    let px = x - o[0], py = y - o[1], pz = z - o[2];
    if (rot) {
      const lx = rot[0] * px + rot[3] * py + rot[6] * pz;
      const ly = rot[1] * px + rot[4] * py + rot[7] * pz;
      const lz = rot[2] * px + rot[5] * py + rot[8] * pz;
      px = lx; py = ly; pz = lz;
    }
    pz *= zs;
    // closest point on the centre line (distance to the polyline, then a smooth radius)
    let best = 1e18, bestT = 0;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[i + 1];
      const bax = b[0] - a[0], bay = b[1] - a[1], baz = (b[2] - a[2]) * zs;
      const pax = px - a[0], pay = py - a[1], paz = pz - a[2] * zs;
      const l2 = bax * bax + bay * bay + baz * baz;
      let h = l2 > 1e-12 ? (pax * bax + pay * bay + paz * baz) / l2 : 0;
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) {
        best = d2;
        bestT = (cum[i] + (cum[i + 1] - cum[i]) * h) / total;
      }
    }
    f.t = bestT;
    return (Math.sqrt(best) - radiusAt(bestT)) * dScale;
  };
  f.t = 0;
  // bounding sphere in world space
  let cx = 0, cy = 0, cz = 0;
  const W = P.map((p) => {
    const w = rot ? mulM3(rot, p) : p;
    return [w[0] + o[0], w[1] + o[1], w[2] + o[2]];
  });
  for (const w of W) { cx += w[0]; cy += w[1]; cz += w[2]; }
  cx /= W.length; cy /= W.length; cz /= W.length;
  let br = 0;
  W.forEach((w, i) => { br = Math.max(br, Math.hypot(w[0] - cx, w[1] - cy, w[2] - cz) + R[i]); });
  f.bound = { c: [cx, cy, cz], r: br };
  f.worldPoints = W;
  /** World position at parameter t (0..1). */
  f.pointAt = (t) => {
    const target = clamp(t, 0, 1) * total;
    let i = 0;
    while (i < n - 1 && cum[i + 1] < target) i++;
    const h = (target - cum[i]) / Math.max(1e-9, cum[i + 1] - cum[i]);
    return [mix(W[i][0], W[i + 1][0], h), mix(W[i][1], W[i + 1][1], h), mix(W[i][2], W[i + 1][2], h)];
  };
  return f;
}

/** Mirror a primitive across the YZ plane (x -> -x). */
export function mirrorX(f) {
  const g = (x, y, z) => {
    const d = f(-x, y, z);
    g.t = f.t;
    return d;
  };
  g.t = 0;
  g.bound = { c: [-f.bound.c[0], f.bound.c[1], f.bound.c[2]], r: f.bound.r };
  if (f.pointAt) g.pointAt = (t) => { const p = f.pointAt(t); return [-p[0], p[1], p[2]]; };
  return g;
}
