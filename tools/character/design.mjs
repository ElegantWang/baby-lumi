// Lumi — the character design, expressed as blended signed-distance parts.
//
// Conventions: Y up, +Z is the direction Lumi faces, +X is Lumi's left (the
// viewer's right). Units are roughly metres; Lumi is ~1.04 tall to the top of
// the head and ~1.42 to the ear tips. "L" parts are authored on +X and
// mirrored to make the "R" twin.
import { ellipsoid, chain, mirrorX, rotYXZ, mulM3, smoothstep, clamp } from './sdf.mjs';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// ---- key landmarks ---------------------------------------------------------
export const HEAD_C = [0, 0.765, 0.02];
export const EYE = { x: 0.152, y: 0.752, rx: 0.079, ry: 0.098, depth: 0.05 };
export const MOUTH = { y: 0.632 };
export const NOSE_C = [0, 0.688, 0.372];

const SHOULDER = [0.2, 0.455, 0.03];
const ELBOW = [0.272, 0.368, 0.065];
const HAND = [0.33, 0.272, 0.1];
const HIP = [0.125, 0.16, 0.01];
const ANKLE = [0.137, 0.068, 0.04];
const FOOT_C = [0.142, 0.05, 0.09];

const EAR_BASE = [0.2, 0.975, 0.0];
const EAR_ROT = rotYXZ(16, -7, -21);
const EAR_FLATTEN = 0.37;

/** Build the list of parts. `withSockets` adds the eye sockets once the eye frames are known. */
export function buildParts(eyeFrames = null) {
  const parts = [];
  const P = (name, sdf, opts) => {
    const part = { name, sdf, op: 'add', k: 0.04, reach: 0.045, fur: 1, ...opts };
    parts.push(part);
    return part;
  };
  const both = (name, sdf, opts) => {
    P(name + 'L', sdf, opts);
    const o = { ...opts };
    if (o.bone) o.bone = flipName(o.bone);
    if (o.bones) o.bones = o.bones.map(([b, t]) => [flipName(b), t]);
    P(name + 'R', mirrorX(sdf), o);
  };

  // ---- torso ----
  P('belly', ellipsoid([0, 0.265, 0.008], [0.25, 0.212, 0.228]), { bone: 'hips', k: 0, fur: 1.0, reach: 0.07 });
  P('chest', ellipsoid([0, 0.43, 0.0], [0.198, 0.165, 0.175]), { bone: 'chest', k: 0.09, fur: 1.0, reach: 0.07 });
  P('chestTuft', ellipsoid([0, 0.468, 0.15], [0.085, 0.07, 0.06]), { bone: 'chest', k: 0.05, fur: 1.9 });

  // ---- legs & feet ----
  both('leg', chain({ pts: [HIP, ANKLE], radii: [0.08, 0.07], perSeg: 1 }), { bone: 'legL1', k: 0.05, fur: 0.8 });
  both('foot', ellipsoid(FOOT_C, [0.083, 0.052, 0.118], rotYXZ(13, 0, 0)), {
    bone: 'footL', k: 0.03, fur: 0.45, accent: () => 0.75, reach: 0.03,
  });

  // ---- arms ----
  both('arm', chain({ pts: [SHOULDER, ELBOW, HAND], radii: [0.062, 0.062, 0.07] }), {
    bones: [['armL1', 0], ['armL2', 0.5]], k: 0.035, fur: 0.75, reach: 0.03,
    accent: (t) => smoothstep(0.42, 1.0, t) * 0.9,
  });

  // ---- head ----
  P('cranium', ellipsoid(HEAD_C, [0.345, 0.275, 0.312]), { bone: 'head', k: 0.03, fur: 0.9 });
  both('cheek', ellipsoid([0.168, 0.665, 0.085], [0.218, 0.172, 0.218]), { bone: 'head', k: 0.08, fur: 0.95 });
  P('chin', ellipsoid([0, 0.64, 0.1], [0.26, 0.15, 0.235]), { bone: 'head', k: 0.08, fur: 0.8 });
  P('muzzle', ellipsoid([0, 0.662, 0.298], [0.118, 0.08, 0.075]), { bone: 'head', k: 0.06, fur: 0.4 });
  P('nose', ellipsoid(NOSE_C, [0.027, 0.019, 0.016]), { bone: 'head', k: 0.012, fur: 0, nose: 1, reach: 0.012 });

  // fluffy cheek tufts and a little forelock (soft clumps; the fur shells do the rest)
  both('cheekTuftA', chain({ pts: [[0.31, 0.7, 0.05], [0.385, 0.69, 0.04], [0.445, 0.672, 0.03]], radii: [0.075, 0.05, 0.022] }), {
    bone: 'head', k: 0.07, fur: 1.3, accent: (t) => smoothstep(0.6, 1.0, t) * 0.55,
  });
  both('cheekTuftB', chain({ pts: [[0.3, 0.63, 0.06], [0.365, 0.6, 0.05], [0.415, 0.565, 0.04]], radii: [0.075, 0.048, 0.022] }), {
    bone: 'head', k: 0.07, fur: 1.3, accent: (t) => smoothstep(0.6, 1.0, t) * 0.55,
  });
  P('forelock', chain({ pts: [[0.0, 0.99, 0.09], [0.012, 1.055, 0.135], [0.045, 1.078, 0.195]], radii: [0.07, 0.045, 0.021] }), {
    bone: 'head', k: 0.06, fur: 1.15, accent: (t) => smoothstep(0.55, 1.0, t) * 0.55,
  });

  // ---- ears (leaf shaped, flattened, three bones each) ----
  const earFrame = { o: EAR_BASE, rot: EAR_ROT, flatten: EAR_FLATTEN };
  const ear = chain({
    pts: [[0, -0.03, 0], [0.004, 0.1, 0], [0.012, 0.22, 0], [0.027, 0.33, -0.004], [0.046, 0.41, -0.012], [0.06, 0.455, -0.02]],
    radii: [0.06, 0.084, 0.096, 0.08, 0.055, 0.036],
    frame: earFrame,
      });
  both('ear', ear, {
    bones: [['earL1', 0.06], ['earL2', 0.4], ['earL3', 0.7]], k: 0.035, fur: 0.62, reach: 0.03,
    accent: (t) => smoothstep(0.42, 0.92, t),
  });
  const scoopC = add(EAR_BASE, mulM3(EAR_ROT, [0.012, 0.215, 0.052]));
  both('earScoop', ellipsoid(scoopC, [0.056, 0.15, 0.03], EAR_ROT), { op: 'sub', k: 0.014, mask: 'innerEar' });

  // ---- tail (a big plume that curls up beside the body) ----
  const tail = chain({
    pts: [[0, 0.2, -0.17], [0.06, 0.165, -0.31], [0.19, 0.19, -0.385], [0.32, 0.29, -0.355], [0.4, 0.42, -0.3], [0.425, 0.535, -0.262]],
    radii: [0.05, 0.07, 0.098, 0.118, 0.1, 0.046],
  });
  P('tail', tail, {
    bones: [['tail1', 0], ['tail2', 0.27], ['tail3', 0.52], ['tail4', 0.76]], k: 0.04, fur: 1.55, reach: 0.035,
    accent: (t) => smoothstep(0.45, 0.95, t),
  });

  // ---- eye sockets (shallow dishes the eyeballs sit in) ----
  if (eyeFrames) {
    for (const f of eyeFrames) {
      const c = add(f.surface, [f.normal[0] * 0.004, f.normal[1] * 0.004, f.normal[2] * 0.004]);
      P('socket' + f.side, ellipsoid(c, [EYE.rx + 0.004, EYE.ry + 0.004, 0.03], f.rot), { op: 'sub', k: 0.012, mask: 'eye' });
    }
  }

  // helpers the builder needs
  parts.byName = Object.fromEntries(parts.map((p) => [p.name, p]));
  return parts;
}

export function flipName(n) {
  if (/L(\d*)$/.test(n)) return n.replace(/L(\d*)$/, 'R$1');
  if (/R(\d*)$/.test(n)) return n.replace(/R(\d*)$/, 'L$1');
  return n;
}

/** Skeleton: [name, parent, restPosition]. Rest orientation is identity for every bone. */
export function buildBones(parts) {
  const earL = parts.byName.earL.sdf, tail = parts.byName.tail.sdf;
  const m = (p) => [-p[0], p[1], p[2]];
  const eL = [earL.pointAt(0.06), earL.pointAt(0.4), earL.pointAt(0.7)];
  const t = [tail.pointAt(0), tail.pointAt(0.27), tail.pointAt(0.52), tail.pointAt(0.76)];
  return [
    ['root', null, [0, 0, 0]],
    ['hips', 'root', [0, 0.2, 0]],
    ['chest', 'hips', [0, 0.37, 0]],
    ['head', 'chest', [0, 0.535, 0.01]],
    ['jaw', 'head', [0, 0.64, 0.12]],
    ['earL1', 'head', eL[0]], ['earL2', 'earL1', eL[1]], ['earL3', 'earL2', eL[2]],
    ['earR1', 'head', m(eL[0])], ['earR2', 'earR1', m(eL[1])], ['earR3', 'earR2', m(eL[2])],
    ['armL1', 'chest', SHOULDER], ['armL2', 'armL1', ELBOW],
    ['armR1', 'chest', m(SHOULDER)], ['armR2', 'armR1', m(ELBOW)],
    ['legL1', 'hips', HIP], ['footL', 'legL1', ANKLE],
    ['legR1', 'hips', m(HIP)], ['footR', 'legR1', m(ANKLE)],
    ['tail1', 'hips', t[0]], ['tail2', 'tail1', t[1]], ['tail3', 'tail2', t[2]], ['tail4', 'tail3', t[3]],
  ];
}

// ---- soft region masks (evaluated per vertex in rest space) -----------------

const ell = (p, c, r) => Math.hypot((p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]);

/** Lighter "white" fur: tummy patch, muzzle and lower face. */
export function whiteMask(p, n) {
  const belly = (1 - smoothstep(0.82, 1.08, ell(p, [0, 0.285, 0.2], [0.185, 0.215, 0.16]))) * smoothstep(-0.1, 0.25, n[2]);
  const face = (1 - smoothstep(0.8, 1.15, ell(p, [0, 0.635, 0.3], [0.2, 0.13, 0.16]))) * smoothstep(0.0, 0.35, n[2]);
  return clamp(Math.max(belly, face), 0, 1);
}

/** How much a vertex follows the jaw (lower lip / chin). */
export function jawMask(p) {
  const d = ell(p, [0, 0.59, 0.27], [0.13, 0.062, 0.13]);
  return (1 - smoothstep(0.55, 1.15, d)) * smoothstep(MOUTH.y + 0.012, MOUTH.y - 0.02, p[1]) * smoothstep(0.1, 0.2, p[2]);
}

/** Cheek puff morph weight. */
export function cheekMask(p) {
  const ax = Math.abs(p[0]);
  return (1 - smoothstep(0.5, 1.0, ell([ax, p[1], p[2]], [0.245, 0.645, 0.2], [0.13, 0.11, 0.15]))) * smoothstep(0.0, 0.12, p[2]);
}

/** Tummy breathing morph weight. */
export function breathMask(p) {
  return 1 - smoothstep(0.4, 1.1, ell(p, [0, 0.33, 0.1], [0.24, 0.22, 0.22]));
}

/** Front-of-face weight: where face decals (mouth, blush, brows, star) may draw. */
export function faceMask(p, n, headWeight) {
  return headWeight * smoothstep(0.05, 0.3, n[2]) * smoothstep(0.02, 0.12, p[2]);
}

// ---- touch colliders & anchors ----------------------------------------------

export function buildColliders(parts) {
  const earL = parts.byName.earL.sdf, tail = parts.byName.tail.sdf;
  const m = (p) => [-p[0], p[1], p[2]];
  const caps = (name, bone, a, b, r, priority = 0) => ({ name, bone, a, b, r, priority });
  const sph = (name, bone, c, r, priority = 0) => ({ name, bone, a: c, b: c, r, priority });
  return [
    sph('nose', 'head', add(NOSE_C, [0, -0.005, 0]), 0.062, 3),
    sph('head', 'head', [0, 0.76, 0.03], 0.33),
    sph('cheekL', 'head', [0.27, 0.65, 0.14], 0.14, 1),
    sph('cheekR', 'head', [-0.27, 0.65, 0.14], 0.14, 1),
    caps('earL', 'earL2', earL.pointAt(0.25), earL.pointAt(0.95), 0.1, 2),
    caps('earR', 'earR2', m(earL.pointAt(0.25)), m(earL.pointAt(0.95)), 0.1, 2),
    sph('belly', 'hips', [0, 0.3, 0.04], 0.235),
    caps('armL', 'armL2', ELBOW, HAND, 0.085, 2),
    caps('armR', 'armR2', m(ELBOW), m(HAND), 0.085, 2),
    sph('footL', 'footL', FOOT_C, 0.11, 2),
    sph('footR', 'footR', m(FOOT_C), 0.11, 2),
    caps('tail', 'tail3', tail.pointAt(0.5), tail.pointAt(0.95), 0.13, 1),
  ];
}

export function buildAnchors(parts, mouthPoint, starPoint) {
  const earL = parts.byName.earL.sdf, tail = parts.byName.tail.sdf;
  const m = (p) => [-p[0], p[1], p[2]];
  return {
    mouth: { bone: 'head', p: mouthPoint },
    nose: { bone: 'head', p: add(NOSE_C, [0, 0, 0.02]) },
    star: { bone: 'head', p: starPoint },
    headTop: { bone: 'head', p: [0, 1.06, 0.02] },
    earTipL: { bone: 'earL3', p: earL.pointAt(1) },
    earTipR: { bone: 'earR3', p: m(earL.pointAt(1)) },
    handL: { bone: 'armL2', p: add(HAND, [0.01, -0.02, 0.03]) },
    handR: { bone: 'armR2', p: m(add(HAND, [0.01, -0.02, 0.03])) },
    belly: { bone: 'hips', p: [0, 0.3, 0.24] },
    footL: { bone: 'footL', p: FOOT_C },
    footR: { bone: 'footR', p: m(FOOT_C) },
    tailTip: { bone: 'tail4', p: tail.pointAt(0.96) },
  };
}
