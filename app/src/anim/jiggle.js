// Secondary motion: ears and tail are driven by little springs so they lag,
// overshoot and settle whenever the body moves. Runs after the keyframed pose.
import * as THREE from 'three';

const _j = new THREE.Vector3();
const _target = new THREE.Vector3();
const _dirT = new THREE.Vector3();
const _dirP = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class Jiggle {
  /** @param {import('../character/lumi.js').Lumi} lumi */
  constructor(lumi) {
    this.lumi = lumi;
    const A = lumi.header.anchors;
    const chain = (names, tipAnchor, opts) => {
      const bones = names.map((n) => lumi.bones[n]);
      return bones.map((bone, i) => {
        const next = i + 1 < bones.length ? bones[i + 1].userData.rest : new THREE.Vector3(...A[tipAnchor].p);
        const tipLocal = next.clone().sub(bone.userData.rest);
        return {
          bone,
          tipLocal,
          length: tipLocal.length(),
          p: new THREE.Vector3(),
          v: new THREE.Vector3(),
          stiffness: opts.stiffness * (1 - i * opts.taper),
          damping: opts.damping,
          gravity: opts.gravity,
          limit: Math.cos(THREE.MathUtils.degToRad(opts.limit)),
          limitAngle: THREE.MathUtils.degToRad(opts.limit),
          ready: false,
        };
      });
    };
    this.chains = [
      chain(['earL1', 'earL2', 'earL3'], 'earTipL', { stiffness: 170, taper: 0.22, damping: 9, gravity: 0.6, limit: 50 }),
      chain(['earR1', 'earR2', 'earR3'], 'earTipR', { stiffness: 170, taper: 0.22, damping: 9, gravity: 0.6, limit: 50 }),
      chain(['tail1', 'tail2', 'tail3', 'tail4'], 'tailTip', { stiffness: 120, taper: 0.16, damping: 7, gravity: 0.3, limit: 55 }),
    ];
    this.amount = 1;
    // fur sway follows the head's motion
    this.headPrev = new THREE.Vector3();
    this.headVel = new THREE.Vector3();
    this.sway = new THREE.Vector3();
    this.first = true;
  }

  reset() {
    for (const c of this.chains) for (const s of c) s.ready = false;
    this.first = true;
  }

  update(dt) {
    if (dt <= 0) return;
    const steps = Math.min(4, Math.max(1, Math.ceil(dt / (1 / 90))));
    const h = dt / steps;
    for (const links of this.chains) {
      for (const s of links) {
        const bone = s.bone;
        bone.updateWorldMatrix(true, false);
        bone.matrixWorld.decompose(_j, _wq, _scale);
        bone.parent.getWorldQuaternion(_pq);
        const len = s.length * _scale.y;
        _target.copy(s.tipLocal).applyQuaternion(_wq).multiplyScalar(_scale.y).add(_j);
        if (!s.ready) {
          s.p.copy(_target);
          s.v.set(0, 0, 0);
          s.ready = true;
        }
        for (let i = 0; i < steps; i++) {
          _tmp.copy(_target).sub(s.p).multiplyScalar(s.stiffness);
          _tmp.y -= s.gravity * 9.8 * 0.1;
          s.v.addScaledVector(_tmp, h);
          s.v.multiplyScalar(Math.exp(-s.damping * h));
          s.p.addScaledVector(s.v, h);
          // stay on the sphere around the joint
          _dirP.copy(s.p).sub(_j);
          const l = _dirP.length() || 1;
          s.p.copy(_j).addScaledVector(_dirP, len / l);
        }
        _dirT.copy(_target).sub(_j).normalize();
        _dirP.copy(s.p).sub(_j).normalize();
        // never bend further than the limit
        const d = _dirT.dot(_dirP);
        if (d < s.limit) {
          const ang = Math.acos(Math.max(-1, Math.min(1, d)));
          _dirP.lerp(_dirT, 1 - s.limitAngle / ang).normalize();
          s.p.copy(_j).addScaledVector(_dirP, len);
          s.v.multiplyScalar(0.6);
        }
        if (this.amount < 1) _dirP.lerp(_dirT, 1 - this.amount).normalize();
        _dq.setFromUnitVectors(_dirT, _dirP);
        // world' = dq * world  ->  local' = parent^-1 * dq * world
        bone.quaternion.copy(_pq).invert().multiply(_dq).multiply(_wq);
      }
    }

    // fur leans against the head's motion (and a touch of wind)
    const head = this.lumi.bones.head;
    head.updateWorldMatrix(true, false);
    _j.setFromMatrixPosition(head.matrixWorld);
    if (this.first) {
      this.headPrev.copy(_j);
      this.first = false;
    }
    _tmp.copy(_j).sub(this.headPrev).divideScalar(dt);
    this.headPrev.copy(_j);
    this.headVel.lerp(_tmp, 1 - Math.exp(-dt * 12));
    _tmp.copy(this.headVel).multiplyScalar(-0.5).clampLength(0, 1.4);
    this.sway.lerp(_tmp, 1 - Math.exp(-dt * 9));
    this.lumi.uniforms.uFurSway.value.copy(this.sway);
  }
}
