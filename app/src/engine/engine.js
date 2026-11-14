// Renderer, camera and quality management.
import * as THREE from 'three';
import { PostFX } from './post.js';

/** Quality tiers, lowest first. The engine moves between them to hold a smooth frame rate. */
export const TIERS = [
  { name: 'low', dpr: 1.0, shells: 9, samples: 0, dof: false, grass: 0.3, shadow: 1024 },
  { name: 'medium', dpr: 1.35, shells: 14, samples: 4, dof: true, grass: 0.55, shadow: 1024 },
  { name: 'high', dpr: 2.0, shells: 20, samples: 4, dof: true, grass: 1.0, shadow: 2048 },
  { name: 'ultra', dpr: 2.0, shells: 30, samples: 4, dof: true, grass: 1.0, shadow: 2048 },
];

export class Engine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{quality?: string, onQuality?: (tier: any) => void}} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x9cc4dc, 1);
    this.renderer.info.autoReset = true;

    this.camera = new THREE.PerspectiveCamera(27, 1, 0.3, 600);
    this.rig = new CameraRig(this.camera);
    this.onQuality = opts.onQuality || (() => {});

    const fixed = TIERS.findIndex((t) => t.name === opts.quality);
    this.adaptive = fixed < 0;
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.tierIndex = fixed >= 0 ? fixed : coarse ? 1 : 2;
    this.post = null;
    this.frameTimes = [];
    this.settle = 0; // seconds to wait before judging performance again
    this.downgrades = 0;
    this.#applyTier();
    this.resize();
  }

  get tier() {
    return TIERS[this.tierIndex];
  }

  #applyTier() {
    const t = this.tier;
    this.post?.dispose();
    this.post = new PostFX(this.renderer, { dof: t.dof, bloom: true, samples: t.samples });
    this.width = 0; // force a resize
    this.resize();
    this.onQuality(t);
    this.settle = 2.5;
    this.frameTimes.length = 0;
  }

  setTier(index) {
    index = Math.max(0, Math.min(TIERS.length - 1, index));
    if (index === this.tierIndex) return;
    this.tierIndex = index;
    this.#applyTier();
  }

  resize() {
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.tier.dpr);
    // cap the pixel count so huge monitors do not melt
    const maxPixels = 2560 * 1600;
    const scale = Math.min(1, Math.sqrt(maxPixels / (cssW * dpr * cssH * dpr)));
    const w = Math.max(2, Math.round(cssW * dpr * scale));
    const h = Math.max(2, Math.round(cssH * dpr * scale));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.rig.setAspect(cssW / cssH);
  }

  /** Call once per frame with the real frame delta so quality can adapt. */
  trackPerformance(dt) {
    if (!this.adaptive) return;
    if (this.settle > 0) {
      this.settle -= dt;
      return;
    }
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.frameTimes.length = 0;
    if (median > 1 / 40 && this.tierIndex > 0) {
      this.downgrades++;
      this.setTier(this.tierIndex - 1);
    } else if (median < 1 / 58 && this.tierIndex < 2 && this.downgrades === 0) {
      // only climb if we have never had to step down (avoids ping-ponging)
      this.setTier(this.tierIndex + 1);
    }
  }

  render(scene, time) {
    this.post.render(scene, this.camera, { focus: this.rig.focusDistance, time });
  }
}

/**
 * Frames Lumi for any screen shape, adds a slow breathing drift and a little
 * parallax, and can push in / pull back for moments of emphasis.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.aspect = 1;
    this.target = new THREE.Vector3(0, 0.67, 0);
    this.lookOffset = new THREE.Vector3();
    this.zoom = 1; // < 1 moves closer
    this.zoomGoal = 1;
    this.parallax = new THREE.Vector2();
    this.parallaxGoal = new THREE.Vector2();
    this.follow = new THREE.Vector3(); // Lumi's root offset (jumps etc.)
    this.followGoal = new THREE.Vector3();
    this.shake = 0;
    this.baseDistance = 4.6;
    this.focusDistance = 4.6;
    this.height = 0.97;
    this.fixedView = null;
  }

  setAspect(aspect) {
    this.aspect = aspect;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    // Lumi (with ears, and room to hop) should fill ~72% of the height and never exceed ~82% of the width
    const needH = 1.5 / 0.7;
    const needW = 1.12 / 0.84;
    const dH = needH / 2 / Math.tan(fov / 2);
    const dW = needW / 2 / (Math.tan(fov / 2) * aspect);
    this.baseDistance = Math.max(dH, dW);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt, time) {
    const k = 1 - Math.exp(-dt * 3.2);
    this.zoom += (this.zoomGoal - this.zoom) * k;
    this.parallax.lerp(this.parallaxGoal, 1 - Math.exp(-dt * 2.2));
    this.follow.lerp(this.followGoal, 1 - Math.exp(-dt * 5));
    const dist = this.baseDistance * this.zoom;
    const cam = this.camera;

    if (this.fixedView) {
      const v = this.fixedView;
      cam.position.copy(v.target).addScaledVector(v.dir, v.dist);
      cam.lookAt(v.target);
      this.focusDistance = v.dist;
      return;
    }

    const sway = Math.sin(time * 0.23) * 0.035;
    const bob = Math.sin(time * 0.31 + 1.0) * 0.02;
    const tx = this.target.x + this.follow.x * 0.6;
    const ty = this.target.y + this.follow.y * 0.45 + (1 - this.zoom) * 0.12;
    cam.position.set(
      tx + sway + this.parallax.x * 0.22,
      this.height + ty - this.target.y + bob + this.parallax.y * 0.1 - (1 - this.zoom) * 0.25,
      this.target.z + dist,
    );
    if (this.shake > 0.0001) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.05;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.05;
      this.shake *= Math.exp(-dt * 7);
    }
    cam.lookAt(tx + this.lookOffset.x, ty + this.lookOffset.y, this.target.z);
    this.focusDistance = dist;
  }
}
