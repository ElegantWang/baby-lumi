// Surface-nets mesher: turns a signed distance function into a smooth,
// evenly tessellated triangle mesh with analytic normals.

/**
 * @param {(x:number,y:number,z:number)=>number} map  signed distance
 * @param {{min:number[], max:number[]}} bounds
 * @param {number} cell  grid cell size
 * @returns {{positions: Float32Array, normals: Float32Array, indices: Uint32Array}}
 */
export function surfaceNets(map, bounds, cell) {
  const [x0, y0, z0] = bounds.min;
  const nx = Math.ceil((bounds.max[0] - x0) / cell) + 1;
  const ny = Math.ceil((bounds.max[1] - y0) / cell) + 1;
  const nz = Math.ceil((bounds.max[2] - z0) / cell) + 1;
  const vals = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = z0 + k * cell;
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * cell;
      let o = (k * ny + j) * nx;
      for (let i = 0; i < nx; i++) vals[o++] = map(x0 + i * cell, y, z);
    }
  }

  const cnx = nx - 1, cny = ny - 1, cnz = nz - 1;
  const cellVert = new Int32Array(cnx * cny * cnz).fill(-1);
  const pos = [];
  const corner = new Float32Array(8);
  // corner offsets (dx, dy, dz)
  const CO = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7], // x
    [0, 2], [1, 3], [4, 6], [5, 7], // y
    [0, 4], [1, 5], [2, 6], [3, 7], // z
  ];
  for (let k = 0; k < cnz; k++) {
    for (let j = 0; j < cny; j++) {
      for (let i = 0; i < cnx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = vals[((k + CO[c][2]) * ny + (j + CO[c][1])) * nx + (i + CO[c][0])];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (let e = 0; e < 12; e++) {
          const a = EDGES[e][0], b = EDGES[e][1];
          const va = corner[a], vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += CO[a][0] + (CO[b][0] - CO[a][0]) * t;
          sy += CO[a][1] + (CO[b][1] - CO[a][1]) * t;
          sz += CO[a][2] + (CO[b][2] - CO[a][2]) * t;
          n++;
        }
        cellVert[(k * cny + j) * cnx + i] = pos.length / 3;
        pos.push(x0 + (i + sx / n) * cell, y0 + (j + sy / n) * cell, z0 + (k + sz / n) * cell);
      }
    }
  }

  // Quads: one per sign-changing grid edge, joining the four cells around it.
  const idx = [];
  const cv = (i, j, k) => cellVert[(k * cny + j) * cnx + i];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // split along the shorter diagonal
    const dAC = dist2(pos, a, c), dBD = dist2(pos, b, d);
    if (dAC <= dBD) {
      if (flip) idx.push(a, c, b, a, d, c);
      else idx.push(a, b, c, a, c, d);
    } else {
      if (flip) idx.push(a, d, b, b, d, c);
      else idx.push(a, b, d, b, c, d);
    }
  };
  for (let k = 1; k < cnz; k++) {
    for (let j = 1; j < cny; j++) {
      for (let i = 1; i < cnx; i++) {
        const v0 = vals[(k * ny + j) * nx + i];
        const s0 = v0 < 0;
        // x edge
        if (s0 !== vals[(k * ny + j) * nx + i + 1] < 0) {
          quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), !s0);
        }
        // y edge
        if (s0 !== vals[(k * ny + j + 1) * nx + i] < 0) {
          quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), !s0);
        }
        // z edge
        if (s0 !== vals[((k + 1) * ny + j) * nx + i] < 0) {
          quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), !s0);
        }
      }
    }
  }

  const positions = new Float32Array(pos);
  const count = positions.length / 3;
  const normals = new Float32Array(count * 3);

  // Pull every vertex onto the true surface and take the normal from the gradient.
  const e = cell * 0.25;
  const grad = [0, 0, 0];
  const gradient = (x, y, z) => {
    grad[0] = map(x + e, y, z) - map(x - e, y, z);
    grad[1] = map(x, y + e, z) - map(x, y - e, z);
    grad[2] = map(x, y, z + e) - map(x, y, z - e);
    const l = Math.hypot(grad[0], grad[1], grad[2]) || 1;
    grad[0] /= l; grad[1] /= l; grad[2] /= l;
  };
  for (let v = 0; v < count; v++) {
    let x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    for (let it = 0; it < 3; it++) {
      const d = map(x, y, z);
      gradient(x, y, z);
      const step = Math.max(-cell, Math.min(cell, d)) * 0.9;
      x -= grad[0] * step; y -= grad[1] * step; z -= grad[2] * step;
    }
    gradient(x, y, z);
    positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z;
    normals[v * 3] = grad[0]; normals[v * 3 + 1] = grad[1]; normals[v * 3 + 2] = grad[2];
  }

  // Make every triangle agree with the outward normals.
  const indices = new Uint32Array(idx);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const nxs = normals[a] + normals[b] + normals[c];
    const nys = normals[a + 1] + normals[b + 1] + normals[c + 1];
    const nzs = normals[a + 2] + normals[b + 2] + normals[c + 2];
    if (fx * nxs + fy * nys + fz * nzs < 0) {
      const tmp = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = tmp;
    }
  }
  return { positions, normals, indices, grid: [nx, ny, nz] };
}

function dist2(pos, a, b) {
  const dx = pos[a * 3] - pos[b * 3], dy = pos[a * 3 + 1] - pos[b * 3 + 1], dz = pos[a * 3 + 2] - pos[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}
