// Puts the meadow together.
import * as THREE from 'three';
import { Atmosphere } from './atmosphere.js';
import { createSky } from './sky.js';
import { createGround, createHills, createTrees } from './terrain.js';
import { createGrass, createFlowers } from './grass.js';
import { AirLife } from './particles.js';

export class World {
  /** @param {{grass?: number}} opts */
  constructor(opts = {}) {
    this.env = new Atmosphere();
    this.group = new THREE.Group();
    this.group.name = 'world';
    this.sky = createSky(this.env);
    this.ground = createGround(this.env);
    this.hills = createHills(this.env);
    this.trees = createTrees(this.env);
    this.grass = createGrass(this.env, opts.grass ?? 26000);
    this.flowers = createFlowers(this.env);
    this.air = new AirLife(this.env);
    this.group.add(this.env.group, this.sky, this.ground, this.hills, this.trees, this.grass, this.flowers, this.air.group);
  }

  /** Thin the grass out on slower devices (0..1). */
  setGrassDensity(k) {
    this.grass.geometry.instanceCount = Math.floor(this.grass.userData.total * k);
  }

  update(time, pixelHeight, dt) {
    this.env.update(time, dt);
    this.air.update(time, pixelHeight);
  }
}
