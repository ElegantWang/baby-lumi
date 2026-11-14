// Flowers that spring up wherever the grass is tapped.
import { createFlowerPatch } from '../world/grass.js';
import { terrainHeight } from '../world/terrain.js';

const MAX = 14;

export class Blooms {
  constructor(env) {
    this.patch = createFlowerPatch(env, MAX);
    this.mesh = this.patch.mesh;
    this.mesh.name = 'blooms';
    this.items = [];
  }

  /** Grow a flower at a ground point. Returns the flower's top position. */
  grow(x, z) {
    if (this.items.length >= MAX) this.items.shift().dying = true;
    const palette = this.patch.palette;
    const c = palette[1 + Math.floor(Math.random() * (palette.length - 1))];
    const f = {
      x, z, y: terrainHeight(x, z),
      height: 0.17 + Math.random() * 0.1,
      size: 0.05 + Math.random() * 0.02,
      rnd: Math.random(),
      kind: c[3],
      color: c,
      age: 0,
      life: 45 + Math.random() * 20,
    };
    this.items.push(f);
    return { x, y: f.y + f.height, z };
  }

  update(dt) {
    const { offsets, params, colors, aOffset, aParams, aColor } = this.patch;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      f.age += dt;
      if (f.age > f.life + 1.2) this.items.splice(i, 1);
    }
    let n = 0;
    for (const f of this.items) {
      // spring up with a bounce, wilt away at the end of its life
      const u = Math.min(1, f.age / 0.55);
      const grow = 1 + 2.7 * Math.pow(u - 1, 3) + 1.7 * Math.pow(u - 1, 2);
      const wilt = f.age > f.life ? Math.max(0, 1 - (f.age - f.life) / 1.2) : 1;
      const k = Math.max(0.001, grow * wilt);
      offsets.set([f.x, f.y, f.z], n * 3);
      params.set([f.height * k, f.size * k, f.rnd, f.kind], n * 4);
      colors.set([f.color[0], f.color[1], f.color[2]], n * 3);
      n++;
    }
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      aOffset.needsUpdate = true;
      aParams.needsUpdate = true;
      aColor.needsUpdate = true;
    }
  }
}
