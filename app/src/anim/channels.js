// Animation channels: one flat array of numbers that fully describes a pose
// (every bone rotation in degrees, a few offsets, and the whole face).
import * as THREE from 'three';

export const FACE_DEFAULTS = {
  mouthOpen: 0, mouthWide: 0, smile: 0.55, pout: 0, tongue: 0,
  lidUpperL: 0, lidUpperR: 0, lidLowerL: 0, lidLowerR: 0, lidTilt: 0,
  gazeX: 0, gazeY: 0, gazeCross: 0, pupil: 0.56,
  sparkle: 0, heart: 0, tear: 0,
  blush: 0, star: 0,
  browRaiseL: 0, browRaiseR: 0, browTiltL: 0, browTiltR: 0,
  cheekPuff: 0, breath: 0,
};

// extra, non-rotation channels
const EXTRA = [
  'root.px', 'root.py', 'root.pz', // move the whole character
  'root.squash', // >0 squash (short & wide), <0 stretch (tall & thin)
  'hips.py', // crouch / rise
  'head.py', // neck stretch
  'head.s', // head scale (emphasis)
  'armL.len', 'armR.len', // arm stretch
  'legL.len', 'legR.len', // leg stretch
];

const DEG = Math.PI / 180;
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Channels {
  constructor(lumi) {
    this.lumi = lumi;
    this.names = [];
    this.index = {};
    this.defaults = [];
    const add = (name, dflt = 0) => {
      this.index[name] = this.names.length;
      this.names.push(name);
      this.defaults.push(dflt);
    };
    this.boneSlots = [];
    for (const bone of lumi.boneList) {
      const base = this.names.length;
      add(bone.name + '.rx');
      add(bone.name + '.ry');
      add(bone.name + '.rz');
      this.boneSlots.push({ bone, base });
    }
    for (const n of EXTRA) add(n);
    this.faceKeys = Object.keys(FACE_DEFAULTS);
    this.faceBase = this.names.length;
    for (const k of this.faceKeys) add(k, FACE_DEFAULTS[k]);
    this.count = this.names.length;
    this.values = new Float32Array(this.defaults);
    this.defaultValues = new Float32Array(this.defaults);
  }

  reset() {
    this.values.set(this.defaultValues);
  }

  get(name) {
    return this.values[this.index[name]];
  }

  set(name, v) {
    this.values[this.index[name]] = v;
  }

  add(name, v) {
    this.values[this.index[name]] += v;
  }

  /** Push the current values onto the skeleton and the face. */
  apply() {
    const v = this.values, ix = this.index, bones = this.lumi.bones;
    for (const { bone, base } of this.boneSlots) {
      _e.set(v[base] * DEG, v[base + 1] * DEG, v[base + 2] * DEG);
      bone.quaternion.setFromEuler(_e);
      bone.position.copy(bone.userData.restLocal);
      bone.scale.set(1, 1, 1);
    }
    const root = bones.root;
    root.position.set(v[ix['root.px']], v[ix['root.py']], v[ix['root.pz']]);
    // squash & stretch keeps volume: shorter means wider
    const sy = Math.max(0.35, 1 - v[ix['root.squash']]);
    const sxz = 1 / Math.sqrt(sy);
    root.scale.set(sxz, sy, sxz);
    bones.hips.position.y += v[ix['hips.py']];
    bones.head.position.y += v[ix['head.py']];
    const hs = 1 + v[ix['head.s']];
    bones.head.scale.set(hs, hs, hs);
    for (const side of ['L', 'R']) {
      const arm = v[ix[`arm${side}.len`]];
      if (arm !== 0) {
        bones[`arm${side}1`].scale.setScalar(1 + arm);
      }
      const leg = v[ix[`leg${side}.len`]];
      if (leg !== 0) bones[`leg${side}1`].scale.setScalar(1 + leg);
    }
    const face = this.lumi.face;
    for (let i = 0; i < this.faceKeys.length; i++) face[this.faceKeys[i]] = v[this.faceBase + i];
  }
}

/**
 * Expand a channel pattern. "arm*1.rz" covers both sides; the right side is
 * mirrored (yaw and roll flip sign) so symmetric motion is written once.
 * @returns {{name: string, sign: number}[]}
 */
export function expandChannel(pattern) {
  if (!pattern.includes('*')) return [{ name: pattern, sign: 1 }];
  const left = pattern.replace('*', 'L');
  const right = pattern.replace('*', 'R');
  const flips = /\.(ry|rz|px)$/.test(pattern) || /^(gazeX)$/.test(pattern);
  return [
    { name: left, sign: 1 },
    { name: right, sign: flips ? -1 : 1 },
  ];
}
