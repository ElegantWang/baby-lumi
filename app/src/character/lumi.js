// Assembles Lumi: skinned body, fur layers, eyes, and the "face" parameter
// block that animation drives.
import * as THREE from 'three';
import { buildSkeleton } from './loader.js';
import { createFurUniforms, createFurMaterial } from './furMaterial.js';
import { createEyeMaterial, createEyeGeometry } from './eyeMaterial.js';

export class Lumi {
  /**
   * @param {{geometry: THREE.BufferGeometry, header: any}} asset
   * @param {import('../world/atmosphere.js').Atmosphere} env
   * @param {{shells?: number}} opts
   */
  constructor(asset, env, opts = {}) {
    const { geometry, header } = asset;
    this.header = header;
    this.geometry = geometry;
    this.group = new THREE.Group();
    this.group.name = 'lumi';

    const rig = buildSkeleton(header);
    this.skeleton = rig.skeleton;
    this.bones = rig.byName;
    this.boneList = rig.bones;

    this.uniforms = createFurUniforms(header, env);

    // skin: the opaque body the fur grows from (and the only shadow caster)
    this.skin = new THREE.SkinnedMesh(geometry, createFurMaterial(this.uniforms, 0));
    this.skin.add(rig.root);
    this.skin.bind(this.skeleton, new THREE.Matrix4());
    this.skin.frustumCulled = false;
    this.skin.castShadow = true;
    this.skin.receiveShadow = true;
    this.group.add(this.skin);

    this.shells = [];
    this.setShellCount(opts.shells ?? 20);

    // eyes ride on the head bone
    this.eyes = [];
    const eyeGeo = createEyeGeometry();
    const head = this.bones.head;
    for (const e of header.eyes) {
      const side = e.side === 'L' ? 1 : -1;
      const mat = createEyeMaterial(this.uniforms, side, e.radii);
      const mesh = new THREE.Mesh(eyeGeo, mat);
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...e.right),
        new THREE.Vector3(...e.up),
        new THREE.Vector3(...e.normal),
      );
      mesh.quaternion.setFromRotationMatrix(basis);
      mesh.position.set(...e.center).sub(head.userData.rest);
      mesh.scale.set(...e.radii);
      mesh.frustumCulled = false;
      head.add(mesh);
      this.eyes.push({ side, mesh, u: mat.uniforms, depth: e.radii[2] });
    }

    // Everything expressive about the face, in one plain object. Animation
    // writes here; applyFace() copies it to the shaders every frame.
    this.face = {
      mouthOpen: 0, mouthWide: 0, smile: 0.55, pout: 0, tongue: 0,
      lidUpperL: 0, lidUpperR: 0, lidLowerL: 0, lidLowerR: 0, lidTilt: 0,
      gazeX: 0, gazeY: 0, gazeCross: 0, pupil: 0.56,
      sparkle: 0, heart: 0, tear: 0,
      blush: 0, star: 0,
      browRaiseL: 0, browRaiseR: 0, browTiltL: 0, browTiltR: 0,
      cheekPuff: 0, breath: 0,
    };
  }

  /** Fur quality: number of layers drawn over the skin (0 disables fur). */
  setShellCount(n) {
    for (const s of this.shells) {
      this.group.remove(s);
      s.material.dispose();
    }
    this.shells = [];
    for (let i = 1; i <= n; i++) {
      const mesh = new THREE.SkinnedMesh(this.geometry, createFurMaterial(this.uniforms, i / n));
      mesh.bind(this.skeleton, new THREE.Matrix4());
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.renderOrder = i;
      this.group.add(mesh);
      this.shells.push(mesh);
    }
    this.shellCount = n;
  }

  applyFace() {
    const f = this.face, u = this.uniforms;
    u.uMouth.value.set(f.mouthOpen, f.mouthWide, f.smile, f.pout);
    u.uTongue.value = f.tongue;
    u.uStarGlow.value = f.star;
    u.uBlush.value = f.blush;
    u.uBrow.value.set(f.browRaiseL, f.browRaiseR, f.browTiltL, f.browTiltR);
    u.uCheekPuff.value = f.cheekPuff;
    u.uBreath.value = f.breath;
    for (const e of this.eyes) {
      const L = e.side > 0;
      e.u.uGaze.value.set(f.gazeX - e.side * f.gazeCross, f.gazeY);
      e.u.uPupil.value = f.pupil;
      const up = L ? f.lidUpperL : f.lidUpperR;
      const low = L ? f.lidLowerL : f.lidLowerR;
      e.u.uLidUpper.value = up;
      e.u.uLidLower.value = low;
      // a shut eye settles back into the fur instead of bulging like an open one
      const shut = Math.min(1, Math.max(0, (Math.max(up, low * 0.9) - 0.55) / 0.4));
      e.mesh.scale.z = e.depth * (1 - 0.5 * shut);
      e.u.uLidTilt.value = f.lidTilt;
      e.u.uSparkle.value = f.sparkle;
      e.u.uHeart.value = f.heart;
      e.u.uTear.value = f.tear;
    }
  }

  /** World position of a named anchor (mouth, handL, headTop, ...). */
  anchorWorld(name, out = new THREE.Vector3()) {
    const a = this.header.anchors[name];
    const bone = this.bones[a.bone];
    return out.set(...a.p).sub(bone.userData.rest).applyMatrix4(bone.matrixWorld);
  }
}
