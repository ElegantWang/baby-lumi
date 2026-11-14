// Lumi's repertoire: stances, facial expressions and action clips.
//
// Axes (bones are world-aligned at rest; Lumi faces +Z, her left is +X):
//   rx  + pitches forward/down (head nods, ears fold forward), - leans back
//   ry  + turns toward her left (viewer's right)
//   rz  + rolls: for the LEFT arm/leg/ear it lifts outward; "*" channels mirror
//       automatically for the right side
// Rotations are degrees, offsets are metres, face channels are 0..1.
import { FACE_DEFAULTS } from './channels.js';

const DEG = Math.PI / 180;

/** Build the library for a particular character (needs its proportions). */
export function buildLibrary(header) {
  const boneRest = Object.fromEntries(header.bones.map((b) => [b.name, b.pos]));
  const S = boneRest.armL1; // left shoulder
  const H = header.anchors.handL.p; // left hand at rest
  const d0 = [H[0] - S[0], H[1] - S[1], H[2] - S[2]];
  const restLen = Math.hypot(...d0);
  const d0n = d0.map((x) => x / restLen);

  /**
   * Aim an arm so the paw lands on a point (in Lumi's rest space, written for
   * the LEFT side; pass side 'R' to mirror). Returns channel values.
   */
  function reach(side, target, stretchMax = 0.9) {
    // solve on the left side; the right arm is the mirror image (yaw flips sign)
    const d = [target[0] - S[0], target[1] - S[1], target[2] - S[2]];
    const dist = Math.hypot(...d);
    const u = d.map((x) => x / dist);
    const A = Math.hypot(d0n[1], d0n[2]);
    const delta = Math.atan2(d0n[2], d0n[1]);
    const rx = Math.acos(Math.max(-1, Math.min(1, u[1] / A))) - delta;
    const zAfter = d0n[1] * Math.sin(rx) + d0n[2] * Math.cos(rx);
    const ry = Math.atan2(u[0], u[2]) - Math.atan2(d0n[0], zAfter);
    const sgn = side === 'L' ? 1 : -1;
    return {
      [`arm${side}1.rx`]: rx / DEG,
      [`arm${side}1.ry`]: (ry / DEG) * sgn,
      [`arm${side}.len`]: Math.max(-0.15, Math.min(stretchMax, dist / restLen - 1)),
    };
  }
  const reachBoth = (target, stretchMax) => ({ ...reach('L', target, stretchMax), ...reach('R', target, stretchMax) });

  // ---- reusable pose pieces ---------------------------------------------------
  const P = {
    // Lumi's head is wider than her shoulders, so "arms up" means up-and-out beside her cheeks
    armsUp: reachBoth([0.47, 0.66, 0.17], 0.45),
    armsHigh: reachBoth([0.5, 0.84, 0.16], 0.62),
    armsOut: { 'arm*1.rz': 62 },
    armsBack: { 'arm*1.rz': -4, 'arm*1.rx': 38 },
    armsFwd: { 'arm*1.rx': -62, 'arm*1.rz': 6 },
    pawsMouth: reachBoth([0.075, 0.6, 0.385]),
    pawsCheeks: reachBoth([0.235, 0.63, 0.31]),
    pawsEyes: reachBoth([0.15, 0.755, 0.365]),
    pawsTummy: reachBoth([0.1, 0.31, 0.27]),
    pawsChest: reachBoth([0.07, 0.47, 0.27]),
    clapIn: reachBoth([0.035, 0.43, 0.34]),
    clapOut: reachBoth([0.17, 0.44, 0.31]),
    earsUp: { 'ear*1.rz': 9, 'ear*2.rz': 5 },
    earsBack: { 'ear*1.rx': -24, 'ear*2.rx': -14 },
    earsFwd: { 'ear*1.rx': 22, 'ear*2.rx': 12 },
    earsDroop: { 'ear*1.rz': -30, 'ear*2.rz': -24, 'ear*3.rz': -16, 'ear*1.rx': 8 },
    // faces
    joy: { 'lidLower*': 0.78, 'lidUpper*': 0.1, smile: 1, mouthOpen: 0.55, blush: 0.5 },
    happy: { 'lidLower*': 0.34, smile: 1, blush: 0.3 },
    grin: { smile: 1, mouthOpen: 0.3 },
    wow: { sparkle: 1, pupil: 0.64, smile: 1, mouthOpen: 0.42, 'browRaise*': 1 },
    gasp: { pupil: 0.42, mouthOpen: 0.5, mouthWide: -0.7, smile: 0.1, 'browRaise*': 1 },
    shut: { 'lidUpper*': 1, smile: 0.6 },
    squint: { 'lidUpper*': 0.45, 'lidLower*': 0.55 },
  };

  const faceDefault = (pattern) => {
    const k = pattern.replace('*', 'L');
    return k in FACE_DEFAULTS ? FACE_DEFAULTS[k] : 0;
  };

  /** Turn full-pose keyframes [[t, pose, ease], ...] into per-channel tracks. */
  function fromPoses(keys) {
    const channels = new Set();
    for (const k of keys) for (const c of Object.keys(k[1])) channels.add(c);
    const tracks = {};
    for (const c of channels) {
      tracks[c] = keys.map(([t, pose, ease]) => [t, c in pose ? pose[c] : faceDefault(c), ease || 'inOut']);
    }
    return tracks;
  }

  /** A decaying / sustained wobble as keyframes. */
  function osc(t0, t1, freq, amp, { phase = 0, base = 0, fade = 0.15 } = {}) {
    const keys = [[t0, base, 'sine']];
    const step = 1 / (freq * 4);
    for (let t = t0 + step * 0.5; t < t1 - step * 0.25; t += step) {
      const env = Math.min(1, (t - t0) / fade, (t1 - t) / fade);
      keys.push([+t.toFixed(4), base + amp * env * Math.sin((t - t0) * freq * Math.PI * 2 + phase), 'linear']);
    }
    keys.push([t1, base, 'sine']);
    return keys;
  }

  const clip = (poses, extra = {}) => {
    const { tracks: more, ...rest } = extra;
    return { tracks: { ...fromPoses(poses), ...(more || {}) }, ...rest };
  };

  // ---- stances (added on top of the idle layer) --------------------------------
  const sit = {
    'root.py': -0.078, 'leg*1.rx': -80, 'leg*1.rz': 11, 'foot*.rx': -4,
    'hips.rx': -7, 'chest.rx': 5, 'arm*1.rz': -15, 'arm*2.rx': -22, 'tail1.rx': -10,
  };
  const STANCES = {
    stand: { 'arm*1.rz': -11, 'arm*2.rx': -12 },
    perky: { 'arm*1.rz': -4, 'arm*2.rx': -10, 'ear*1.rz': 7, 'chest.rx': -3, 'head.rx': -3 },
    listen: { 'arm*1.rz': -10, 'arm*2.rx': -14, 'head.rz': 8, 'ear*1.rx': 9, 'ear*1.rz': 8, 'ear*2.rz': 4, 'chest.rx': 4, 'hips.rz': -2 },
    sleepy: { 'arm*1.rz': -15, 'arm*2.rx': -8, 'head.rx': 9, 'chest.rx': 6, 'ear*1.rz': -22, 'ear*2.rz': -18, 'ear*3.rz': -10 },
    sad: { 'arm*1.rz': -16, 'head.rx': 15, 'chest.rx': 8, ...P.earsDroop },
    sit,
    asleep: {
      ...sit, 'head.rx': 26, 'head.rz': 10, 'chest.rx': 13, 'hips.rx': -2,
      'ear*1.rz': -34, 'ear*2.rz': -28, 'ear*3.rz': -20, 'ear*1.rx': 14, 'arm*1.rz': -19, 'arm*2.rx': -30,
    },
    petted: { 'arm*1.rz': -12, 'arm*2.rx': -16, 'ear*1.rz': -16, 'ear*2.rz': -12, 'chest.rx': 3, 'head.rx': 5 },
  };

  // ---- expressions (the face eases toward these) ---------------------------------
  const EXPRESSIONS = {
    neutral: {},
    happy: { lidLowerL: 0.3, lidLowerR: 0.3, smile: 1, blush: 0.25 },
    joy: { lidLowerL: 0.78, lidLowerR: 0.78, lidUpperL: 0.1, lidUpperR: 0.1, smile: 1, mouthOpen: 0.45, blush: 0.5 },
    bliss: { lidLowerL: 0.86, lidLowerR: 0.86, lidUpperL: 0.12, lidUpperR: 0.12, smile: 1, blush: 0.8 },
    wow: { sparkle: 1, pupil: 0.64, smile: 1, mouthOpen: 0.4, browRaiseL: 1, browRaiseR: 1 },
    love: { heart: 1, blush: 1, smile: 1, lidLowerL: 0.2, lidLowerR: 0.2 },
    curious: { pupil: 0.62, browRaiseL: 1, browRaiseR: 0.2, smile: 0.45, mouthOpen: 0.08 },
    surprised: { pupil: 0.42, mouthOpen: 0.5, mouthWide: -0.7, smile: 0.1, browRaiseL: 1, browRaiseR: 1 },
    shy: { blush: 1, lidUpperL: 0.22, lidUpperR: 0.22, smile: 0.7, gazeY: -0.5, gazeX: 0.35 },
    sad: { lidTilt: 0.9, lidUpperL: 0.22, lidUpperR: 0.22, smile: -0.9, tear: 0.7, browTiltL: 0.45, browTiltR: 0.45, pout: 0.3 },
    sleepy: { lidUpperL: 0.52, lidUpperR: 0.52, smile: 0.3, lidTilt: 0.4, pupil: 0.5 },
    asleep: { lidUpperL: 1, lidUpperR: 1, smile: 0.45, mouthOpen: 0.07 },
    cheeky: { tongue: 1, lidLowerL: 0.5, lidLowerR: 0.5, smile: 1, lidUpperR: 0.9 },
    proud: { lidTilt: -0.5, lidLowerL: 0.3, lidLowerR: 0.3, smile: 1, browTiltL: -0.3, browTiltR: -0.3 },
    chew: { lidLowerL: 0.7, lidLowerR: 0.7, smile: 0.8, cheekPuff: 0.6, blush: 0.3 },
    listening: { pupil: 0.63, browRaiseL: 0.6, browRaiseR: 0.6, smile: 0.5, star: 0.9 },
  };

  // ---- action clips ----------------------------------------------------------------
  const CLIPS = {};

  CLIPS.wave = clip(
    [
      [0, {}],
      [0.28, { ...reach('L', [0.5, 0.74, 0.2], 0.55), 'hips.rz': -5, 'head.rz': 9, 'chest.rz': -3, ...P.grin, ...P.earsUp, 'root.py': 0.02 }, 'outBack'],
      [1.75, { ...reach('L', [0.5, 0.72, 0.2], 0.55), 'hips.rz': -5, 'head.rz': 9, 'chest.rz': -3, ...P.happy, mouthOpen: 0.2, ...P.earsUp }],
      [2.2, {}, 'inOut'],
    ],
    { tracks: { 'armL2.rz': osc(0.3, 1.75, 2.6, 34), 'armL1.rz': [[0, 0], ...osc(0.3, 1.75, 2.6, 12), [2.2, 0]] }, look: 1, idle: 0.6 },
  );

  CLIPS.jump = clip(
    [
      [0, {}],
      [0.16, { 'root.squash': 0.2, 'hips.py': -0.02, ...P.armsBack, 'head.rx': 8, 'lidLower*': 0.4, smile: 1 }, 'out'],
      [0.3, { 'root.squash': -0.16, 'root.py': 0.2, ...P.armsUp, 'head.rx': -8, ...P.grin, 'leg*1.rx': 12 }, 'out'],
      [0.52, { 'root.squash': -0.03, 'root.py': 0.44, ...P.armsHigh, 'head.rx': -6, ...P.joy, 'leg*1.rx': -18, 'foot*.rx': 18 }, 'out'],
      [0.74, { 'root.squash': -0.12, 'root.py': 0.16, ...P.armsUp, 'head.rx': 2, ...P.joy, 'leg*1.rx': 4 }, 'in'],
      [0.84, { 'root.squash': 0.24, 'root.py': 0, ...P.armsOut, 'head.rx': 10, ...P.joy }, 'in'],
      [0.98, { 'root.squash': -0.06, 'root.py': 0.03, 'arm*1.rz': 20, ...P.happy }, 'out'],
      [1.14, { 'root.squash': 0.03, ...P.happy }, 'inOut'],
      [1.3, {}, 'inOut'],
    ],
    { events: [[0.16, 'sfx', 'jump'], [0.84, 'sfx', 'land'], [0.84, 'puff']], look: 0.7, idle: 0.1 },
  );

  CLIPS.hop = clip(
    [
      [0, {}],
      [0.1, { 'root.squash': 0.12, 'arm*1.rz': -6 }, 'out'],
      [0.27, { 'root.squash': -0.08, 'root.py': 0.13, 'arm*1.rz': 40, 'leg*1.rx': -10, smile: 1 }, 'out'],
      [0.44, { 'root.squash': 0.13, 'arm*1.rz': 14, smile: 1 }, 'in'],
      [0.56, { 'root.squash': -0.03, smile: 1 }, 'out'],
      [0.7, {}, 'inOut'],
    ],
    { events: [[0.44, 'sfx', 'step']], look: 1, idle: 0.3 },
  );

  CLIPS.spin = clip(
    [
      [0, {}],
      [0.18, { 'root.squash': 0.14, 'root.ry': -24, 'arm*1.rz': 10, 'hips.ry': -8 }, 'out'],
      [0.95, { 'root.squash': -0.07, 'root.ry': 372, 'root.py': 0.12, ...P.armsOut, ...P.joy, 'head.rz': 8 }, 'inOut'],
      [1.12, { 'root.squash': 0.1, 'root.ry': 356, 'arm*1.rz': 30, ...P.joy }, 'out'],
      [1.3, { 'root.ry': 360, ...P.happy }, 'inOut'],
      [1.42, { 'root.ry': 360 }, 'inOut'],
    ],
    { fadeOut: 0.001, look: 0, idle: 0, blink: false, events: [[0.18, 'sfx', 'whoosh'], [1.12, 'sfx', 'step']] },
  );

  CLIPS.giggle = clip(
    [
      [0, {}],
      [0.2, { ...P.pawsMouth, ...P.joy, 'head.rz': 7, 'chest.rx': 6, 'head.rx': 6, blush: 0.8 }, 'outBack'],
      [0.75, { ...P.pawsMouth, ...P.joy, 'head.rz': -7, 'chest.rx': 8, 'head.rx': 8, blush: 0.8 }],
      [1.3, { ...P.pawsMouth, ...P.joy, 'head.rz': 6, 'chest.rx': 6, 'head.rx': 5, blush: 0.8 }],
      [1.7, {}, 'inOut'],
    ],
    { tracks: { 'root.py': osc(0.15, 1.45, 7, 0.012, { base: 0.012 }), 'chest.rz': osc(0.2, 1.4, 3.5, 2.5) }, look: 0.8, idle: 0.2 },
  );

  CLIPS.tickle = clip(
    [
      [0, {}],
      [0.14, { 'root.squash': 0.08, 'head.rx': -12, 'lidUpper*': 0.3, 'lidLower*': 0.82, smile: 1, mouthOpen: 0.85, mouthWide: 0.4, 'arm*1.rz': 58, blush: 0.7 }, 'outBack'],
      [1.75, { 'root.squash': 0.04, 'head.rx': -9, 'lidUpper*': 0.3, 'lidLower*': 0.82, smile: 1, mouthOpen: 0.75, mouthWide: 0.4, 'arm*1.rz': 50, blush: 0.9 }],
      [2.2, { ...P.happy, blush: 0.5 }, 'inOut'],
      [2.5, {}, 'inOut'],
    ],
    {
      tracks: {
        'hips.ry': osc(0.1, 1.8, 3.2, 13),
        'chest.rz': osc(0.1, 1.8, 3.2, 7, { phase: 1.2 }),
        'head.rz': osc(0.1, 1.8, 2.1, 9, { phase: 0.5 }),
        'armL2.rz': osc(0.1, 1.8, 5.3, 26),
        'armR2.rz': osc(0.1, 1.8, 5.3, 26, { phase: 2.4 }),
        'legL1.rx': osc(0.1, 1.8, 4.1, 16, { base: -14 }),
        'legR1.rx': osc(0.1, 1.8, 4.1, 16, { base: -14, phase: 3.14 }),
        'root.py': osc(0.1, 1.8, 6.4, 0.012, { base: 0.014 }),
      },
      look: 0.3, idle: 0, blink: false,
    },
  );

  CLIPS.boop = clip(
    [
      [0, {}],
      [0.09, { 'head.rx': -11, 'root.pz': -0.035, 'root.squash': 0.07, gazeCross: 0.95, gazeY: -0.35, pupil: 0.44, 'browRaise*': 1, mouthOpen: 0.16, mouthWide: -0.6, ...P.earsBack }, 'out'],
      [0.55, { 'head.rx': -5, 'root.pz': -0.015, gazeCross: 0.95, gazeY: -0.4, pupil: 0.48, 'browRaise*': 1, mouthOpen: 0.1, mouthWide: -0.6 }],
      [0.68, { 'head.rx': -3, gazeCross: 0.5, 'lidUpper*': 1 }, 'inOut'],
      [0.8, { 'head.rx': 0, gazeCross: 0.1 }, 'inOut'],
      [0.9, { 'lidUpper*': 1 }, 'inOut'],
      [1.05, { ...P.happy, 'head.rz': 7, cheekPuff: 0.3 }, 'outBack'],
      [1.5, { ...P.happy, 'head.rz': 5 }],
      [1.8, {}, 'inOut'],
    ],
    { tracks: { cheekPuff: [[0, 0], [0.12, 0.5, 'out'], [0.3, 0, 'inOut'], [0.42, 0.4, 'out'], [0.58, 0, 'inOut'], [1.8, 0]] }, look: 0.4, idle: 0.2, blink: false },
  );

  CLIPS.sneeze = clip(
    [
      [0, {}],
      [0.35, { 'head.rx': -10, 'lidUpper*': 0.35, mouthOpen: 0.3, mouthWide: -0.3, 'browRaise*': 0.8, 'chest.rx': -4, ...P.earsBack, 'arm*1.rz': 14 }, 'out'],
      [0.6, { 'head.rx': -6, 'lidUpper*': 0.5, mouthOpen: 0.18, mouthWide: -0.3, 'chest.rx': -2 }, 'inOut'],
      [1.05, { 'head.rx': -22, 'lidUpper*': 0.6, mouthOpen: 0.7, mouthWide: -0.2, 'browRaise*': 1, 'chest.rx': -9, 'root.squash': -0.05, ...P.earsBack, 'arm*1.rz': 30 }, 'out'],
      [1.14, { 'head.rx': 30, 'lidUpper*': 1, mouthOpen: 0.45, mouthWide: 0.5, 'chest.rx': 20, 'root.squash': 0.2, 'root.py': 0.05, ...P.earsFwd, 'arm*1.rz': 46, cheekPuff: 0.5 }, 'in'],
      [1.38, { 'head.rx': 12, 'lidUpper*': 1, 'chest.rx': 8, 'root.squash': -0.03, 'arm*1.rz': 10 }, 'out'],
      [1.75, { 'head.rx': 0, 'lidUpper*': 0.3, smile: 0.2, 'head.rz': -6 }, 'inOut'],
      [2.3, { ...P.happy, 'head.rz': 4, blush: 0.5 }, 'inOut'],
      [2.6, {}, 'inOut'],
    ],
    { tracks: { 'head.ry': [[0, 0], [1.5, 0], ...osc(1.5, 2.1, 5, 9).slice(1), [2.6, 0]] }, events: [[1.12, 'sfx', 'achoo'], [1.14, 'puff']], look: 0.2, idle: 0.1, blink: false },
  );

  CLIPS.yawn = clip(
    [
      [0, {}],
      [0.5, { 'head.rx': -8, mouthOpen: 0.35, mouthWide: -0.4, 'lidUpper*': 0.5, smile: 0.2, 'arm*1.rz': 30 }, 'inOut'],
      [1.2, { 'head.rx': -20, mouthOpen: 1, mouthWide: -0.25, 'lidUpper*': 1, smile: 0.1, ...P.armsHigh, 'root.squash': -0.07, 'chest.rx': -7, ...P.earsBack, tongue: 0.2 }, 'inOut'],
      [1.9, { 'head.rx': -18, mouthOpen: 0.95, mouthWide: -0.25, 'lidUpper*': 1, smile: 0.1, ...P.armsHigh, 'root.squash': -0.06, 'chest.rx': -6, ...P.earsBack, tear: 0.6 }],
      [2.5, { 'head.rx': 6, mouthOpen: 0.1, 'lidUpper*': 0.75, smile: 0.4, 'arm*1.rz': 6, 'root.squash': 0.04, tear: 0.5 }, 'inOut'],
      [2.75, { 'head.rx': 5, mouthOpen: 0.22, 'lidUpper*': 0.65, smile: 0.4 }, 'inOut'],
      [2.95, { 'head.rx': 5, mouthOpen: 0.03, 'lidUpper*': 0.6, smile: 0.5 }, 'inOut'],
      [3.4, { 'lidUpper*': 0.3 }, 'inOut'],
    ],
    { events: [[0.45, 'sfx', 'yawn']], look: 0.2, idle: 0.2, blink: false, fadeOut: 0.5 },
  );

  CLIPS.nod = clip(
    [[0, {}], [0.16, { 'head.rx': 16, ...P.happy }, 'out'], [0.34, { 'head.rx': -5, ...P.happy }], [0.52, { 'head.rx': 14, ...P.happy }], [0.7, { 'head.rx': -3, ...P.happy }], [0.95, {}]],
    { look: 1, idle: 0.6 },
  );

  CLIPS.shake = clip(
    [[0, {}], [0.15, { 'head.ry': -20, smile: 0.2 }, 'out'], [0.38, { 'head.ry': 20, smile: 0.2 }], [0.6, { 'head.ry': -15, smile: 0.2 }], [0.8, { 'head.ry': 10 }], [1.05, {}]],
    { look: 0.2, idle: 0.6 },
  );

  CLIPS.surprise = clip(
    [
      [0, {}],
      [0.1, { 'root.squash': -0.13, 'root.py': 0.07, 'root.pz': -0.05, ...P.armsOut, ...P.gasp, ...P.earsUp, 'head.rx': -7 }, 'outBack'],
      [0.3, { 'root.squash': 0.06, 'root.pz': -0.05, 'arm*1.rz': 44, ...P.gasp, ...P.earsUp, 'head.rx': -4 }, 'in'],
      [0.9, { 'root.pz': -0.04, 'arm*1.rz': 36, ...P.gasp, ...P.earsUp, 'head.rx': -3 }],
      [1.25, {}, 'inOut'],
    ],
    { look: 1, idle: 0.2, blink: false, events: [[0.02, 'sfx', 'pop']] },
  );

  CLIPS.shy = clip(
    [
      [0, {}],
      [0.4, { 'hips.ry': -16, 'head.ry': -12, 'head.rx': 14, 'head.rz': -8, ...P.pawsChest, blush: 1, 'lidUpper*': 0.3, gazeX: -0.5, gazeY: -0.6, smile: 0.7, 'ear*1.rz': -18, 'chest.rx': 6 }, 'inOut'],
      [1.2, { 'hips.ry': -16, 'head.ry': -14, 'head.rx': 15, 'head.rz': -9, ...P.pawsChest, blush: 1, 'lidUpper*': 0.3, gazeX: -0.5, gazeY: -0.6, smile: 0.7, 'ear*1.rz': -20, 'chest.rx': 6 }],
      [1.55, { 'hips.ry': -14, 'head.ry': -4, 'head.rx': 10, 'head.rz': -10, ...P.pawsChest, blush: 1, 'lidUpper*': 0.15, gazeX: 0.5, gazeY: 0.3, smile: 1, 'ear*1.rz': -14 }, 'inOut'],
      [2.2, { 'hips.ry': -12, 'head.ry': -4, 'head.rx': 10, 'head.rz': -10, ...P.pawsChest, blush: 1, 'lidLower*': 0.5, gazeX: 0.5, gazeY: 0.3, smile: 1, 'ear*1.rz': -14 }],
      [2.7, {}, 'inOut'],
    ],
    { tracks: { 'legL1.rx': osc(0.4, 2.2, 1.4, 8, { base: -10 }), 'hips.rz': osc(0.4, 2.2, 0.7, 3) }, look: 0, idle: 0.3 },
  );

  CLIPS.hug = clip(
    [
      [0, {}],
      [0.3, { ...P.armsOut, 'arm*.len': 0.15, 'root.squash': 0.06, ...P.wow, 'chest.rx': -5 }, 'outBack'],
      [0.75, { ...reachBoth([0.12, 0.5, 0.42]), 'root.pz': 0.36, 'root.py': 0.02, 'chest.rx': 10, 'head.rx': 4, 'head.rz': 10, ...P.joy, blush: 1, mouthOpen: 0.15 }, 'inOut'],
      [2.1, { ...reachBoth([0.1, 0.5, 0.42]), 'root.pz': 0.38, 'root.py': 0.02, 'chest.rx': 11, 'head.rx': 5, 'head.rz': 12, ...P.joy, blush: 1, mouthOpen: 0.08 }],
      [2.7, { 'root.pz': 0, ...P.happy }, 'inOut'],
      [3.0, {}, 'inOut'],
    ],
    { tracks: { 'hips.rz': osc(0.8, 2.1, 0.9, 4), 'root.squash': [[0, 0], [0.3, 0.06], [0.75, 0.05], [1.4, 0.09, 'sine'], [2.1, 0.05, 'sine'], [2.7, 0], [3.0, 0]] }, look: 0.6, idle: 0.2, events: [[0.8, 'emote', 'heart', 5]] },
  );

  CLIPS.kiss = clip(
    [
      [0, {}],
      [0.35, { ...reach('L', [0.05, 0.61, 0.41]), 'chest.rx': 10, 'head.rx': 4, pout: 1, smile: 0.3, 'lidUpper*': 1, blush: 0.8, 'root.pz': 0.06 }, 'inOut'],
      [0.7, { ...reach('L', [0.05, 0.61, 0.41]), 'chest.rx': 12, 'head.rx': 5, pout: 1, smile: 0.3, 'lidUpper*': 1, blush: 0.8, 'root.pz': 0.08 }],
      [0.92, { ...reach('L', [0.16, 0.58, 0.52]), 'armL.len': 0.75, 'chest.rx': 2, 'head.rx': -4, ...P.joy, mouthOpen: 0.3, blush: 0.8, 'head.rz': -6 }, 'outBack'],
      [1.5, { ...reach('L', [0.2, 0.56, 0.5]), 'armL.len': 0.6, 'head.rx': -3, ...P.happy, blush: 0.7, 'head.rz': -6 }],
      [1.9, {}, 'inOut'],
    ],
    { events: [[0.72, 'sfx', 'kiss'], [0.9, 'emote', 'heart', 3]], look: 1, idle: 0.3, blink: false },
  );

  CLIPS.cheer = clip(
    [
      [0, {}],
      [0.12, { 'root.squash': 0.16, ...P.armsBack, smile: 1 }, 'out'],
      [0.32, { 'root.squash': -0.12, 'root.py': 0.24, ...P.armsHigh, ...P.joy, 'head.rx': -8 }, 'out'],
      [0.52, { 'root.squash': 0.18, ...P.armsUp, ...P.joy }, 'in'],
      [0.72, { 'root.squash': -0.12, 'root.py': 0.2, ...P.armsHigh, ...P.joy, 'head.rx': -8, 'head.rz': 7 }, 'out'],
      [0.92, { 'root.squash': 0.16, ...P.armsUp, ...P.joy }, 'in'],
      [1.1, { 'root.squash': -0.04, 'arm*1.rz': 70, ...P.joy }, 'out'],
      [1.5, { ...P.happy }, 'inOut'],
      [1.75, {}, 'inOut'],
    ],
    { events: [[0.52, 'sfx', 'step'], [0.92, 'sfx', 'step'], [0.3, 'emote', 'star', 4]], look: 0.8, idle: 0.1 },
  );

  const clapKeys = [[0, {}], [0.2, { ...P.clapOut, ...P.grin, 'chest.rx': 4 }, 'out']];
  const clapEvents = [];
  for (let i = 0; i < 4; i++) {
    const t = 0.34 + i * 0.3;
    clapKeys.push([t, { ...P.clapIn, ...P.joy, 'chest.rx': 5, 'root.squash': 0.035 }, 'in']);
    clapKeys.push([t + 0.15, { ...P.clapOut, ...P.joy, 'chest.rx': 3, 'root.squash': -0.02 }, 'out']);
    clapEvents.push([t, 'sfx', 'clap']);
  }
  clapKeys.push([1.75, { ...P.happy }, 'inOut'], [2.0, {}, 'inOut']);
  CLIPS.clap = clip(clapKeys, { events: clapEvents, tracks: { 'head.rz': osc(0.3, 1.6, 1.66, 5) }, look: 1, idle: 0.3 });

  // dances loop until stopped
  CLIPS.dance1 = clip(
    [
      [0, { ...P.happy, mouthOpen: 0.2 }],
      [0.3, { 'hips.rz': 9, 'root.px': 0.05, 'chest.rz': -5, 'head.rz': -10, 'armL1.rz': 105, 'armR1.rz': -6, 'root.squash': 0.07, ...P.joy, 'legR1.rz': -10 }, 'inOut'],
      [0.6, { 'hips.rz': 4, 'root.px': 0.02, 'head.rz': -4, 'armL1.rz': 60, 'armR1.rz': -30, 'root.squash': -0.04, 'root.py': 0.04, ...P.joy }, 'inOut'],
      [0.9, { 'hips.rz': -9, 'root.px': -0.05, 'chest.rz': 5, 'head.rz': 10, 'armL1.rz': 6, 'armR1.rz': -105, 'root.squash': 0.07, ...P.joy, 'legL1.rz': 10 }, 'inOut'],
      [1.2, { 'hips.rz': -4, 'root.px': -0.02, 'head.rz': 4, 'armL1.rz': 30, 'armR1.rz': -60, 'root.squash': -0.04, 'root.py': 0.04, ...P.joy }, 'inOut'],
      [1.5, { 'hips.rz': 9, 'root.px': 0.05, 'chest.rz': -5, 'head.rz': -10, 'armL1.rz': 105, 'armR1.rz': -6, 'root.squash': 0.07, ...P.joy, 'legR1.rz': -10 }, 'inOut'],
    ],
    { loop: true, look: 0.6, idle: 0, dur: 1.5, events: [[0.3, 'sfx', 'step'], [0.9, 'sfx', 'step']] },
  );
  // make the loop seamless: drop the lead-in key and start on the first beat
  for (const keys of Object.values(CLIPS.dance1.tracks)) {
    keys[0][1] = keys[keys.length - 1][1];
    keys[0][0] = 0.3;
    for (const k of keys) k[0] = +(k[0] - 0.3).toFixed(3);
  }
  CLIPS.dance1.dur = 1.2;
  CLIPS.dance1.events = [[0.02, 'sfx', 'step'], [0.6, 'sfx', 'step']];

  CLIPS.dance2 = {
    loop: true, look: 0.5, idle: 0, dur: 1.2,
    tracks: {
      'hips.ry': [[0, -18, 'sine'], [0.6, 18, 'sine'], [1.2, -18, 'sine']],
      'chest.ry': [[0, 10, 'sine'], [0.6, -10, 'sine'], [1.2, 10, 'sine']],
      'head.rz': [[0, 7, 'sine'], [0.6, -7, 'sine'], [1.2, 7, 'sine']],
      'root.py': [[0, 0, 'out'], [0.15, 0.05, 'out'], [0.3, 0, 'in'], [0.45, 0.05, 'out'], [0.6, 0, 'in'], [0.75, 0.05, 'out'], [0.9, 0, 'in'], [1.05, 0.05, 'out'], [1.2, 0, 'in']],
      'root.squash': [[0, 0.08], [0.15, -0.04], [0.3, 0.08], [0.45, -0.04], [0.6, 0.08], [0.75, -0.04], [0.9, 0.08], [1.05, -0.04], [1.2, 0.08]],
      'armL1.rx': [[0, -70, 'sine'], [0.3, -20, 'sine'], [0.6, -70, 'sine'], [0.9, -20, 'sine'], [1.2, -70, 'sine']],
      'armR1.rx': [[0, -20, 'sine'], [0.3, -70, 'sine'], [0.6, -20, 'sine'], [0.9, -70, 'sine'], [1.2, -20, 'sine']],
      'arm*1.rz': [[0, 24], [1.2, 24]],
      'arm*2.rx': [[0, -40], [1.2, -40]],
      'lidLower*': [[0, 0.75], [1.2, 0.75]],
      smile: [[0, 1], [1.2, 1]],
      mouthOpen: [[0, 0.4], [1.2, 0.4]],
      blush: [[0, 0.4], [1.2, 0.4]],
    },
    events: [[0.3, 'sfx', 'step'], [0.9, 'sfx', 'step']],
  };

  CLIPS.peekaboo = clip(
    [
      [0, {}],
      [0.35, { ...P.pawsEyes, 'head.rx': 12, 'chest.rx': 8, smile: 0.9, 'ear*1.rx': 26, 'ear*2.rx': 22, 'ear*1.rz': -6 }, 'inOut'],
      [1.7, { ...P.pawsEyes, 'head.rx': 13, 'chest.rx': 9, smile: 1, 'ear*1.rx': 28, 'ear*2.rx': 24, 'ear*1.rz': -6 }],
      [1.82, { ...P.pawsEyes, 'head.rx': 16, 'chest.rx': 12, 'root.squash': 0.14, smile: 1, 'ear*1.rx': 30 }, 'in'],
      [2.0, { ...P.armsHigh, 'head.rx': -8, 'chest.rx': -6, 'root.squash': -0.13, 'root.py': 0.13, ...P.wow, mouthOpen: 0.75, ...P.earsUp }, 'outBack'],
      [2.3, { ...P.armsUp, 'head.rx': -4, 'root.squash': 0.1, ...P.wow, mouthOpen: 0.6, ...P.earsUp }, 'in'],
      [2.9, { 'arm*1.rz': 84, ...P.joy, 'head.rz': 7 }, 'inOut'],
      [3.3, {}, 'inOut'],
    ],
    { tracks: { 'head.rz': [[0, 0], [0.5, 0], ...osc(0.5, 1.6, 1.6, 4).slice(1), [3.3, 0]] }, events: [[1.98, 'sfx', 'pop'], [2.0, 'emote', 'star', 5]], look: 0.5, idle: 0.1, blink: false },
  );

  const chew = [];
  for (let i = 0; i < 7; i++) {
    const t = 0.62 + i * 0.25;
    chew.push([t, 0.26, 'sine'], [t + 0.125, 0.02, 'sine']);
  }
  CLIPS.eat = clip(
    [
      [0, {}],
      [0.3, { 'chest.rx': 10, 'head.rx': -4, mouthOpen: 1, mouthWide: 0.1, ...P.pawsMouth, 'browRaise*': 1, pupil: 0.62 }, 'out'],
      [0.48, { 'chest.rx': 14, 'head.rx': 6, mouthOpen: 0.05, ...P.pawsMouth, 'lidLower*': 0.75, cheekPuff: 0.85, 'root.squash': 0.07 }, 'in'],
      [2.3, { 'chest.rx': 5, 'head.rx': 2, ...P.pawsCheeks, 'lidLower*': 0.8, cheekPuff: 0.7, smile: 0.9, blush: 0.5 }],
      [2.5, { 'head.rx': -8, 'lidUpper*': 1, cheekPuff: 0.1, 'head.py': -0.012, smile: 0.8 }, 'inOut'],
      [2.75, { 'head.rx': 3, ...P.joy, mouthOpen: 0.5, tongue: 0, 'head.py': 0.006, ...P.pawsTummy }, 'outBack'],
      [3.6, { ...P.joy, mouthOpen: 0.1, tongue: 1, ...P.pawsTummy, 'head.rz': 8 }],
      [4.1, {}, 'inOut'],
    ],
    {
      tracks: {
        mouthOpen: [[0, 0], [0.3, 1, 'out'], [0.48, 0.03, 'in'], ...chew, [2.5, 0.02], [2.75, 0.5, 'out'], [3.6, 0.12], [4.1, 0]],
        'head.rz': [[0, 0], [0.5, 0], ...osc(0.5, 2.3, 2, 4).slice(1), [3.6, 8], [4.1, 0]],
        'hips.rz': osc(2.8, 3.7, 1.5, 3),
      },
      events: [[0.46, 'sfx', 'chomp'], [0.46, 'bite'], [0.9, 'sfx', 'munch'], [1.4, 'sfx', 'munch'], [1.9, 'sfx', 'munch'], [2.5, 'sfx', 'gulp'], [2.8, 'emote', 'heart', 2]],
      look: 0.3, idle: 0.1, blink: false,
    },
  );

  CLIPS.wake = clip(
    [
      [0, { 'lidUpper*': 1, smile: 0.4 }],
      [0.35, { 'lidUpper*': 0.55, smile: 0.4 }, 'inOut'],
      [0.6, { 'lidUpper*': 0.9, smile: 0.4 }, 'inOut'],
      [0.95, { 'lidUpper*': 0.35, smile: 0.5, 'head.rx': -4 }, 'inOut'],
      [1.6, { ...P.armsHigh, 'root.squash': -0.08, 'head.rx': -14, 'lidUpper*': 1, mouthOpen: 0.75, mouthWide: -0.3, smile: 0.2, ...P.earsBack }, 'inOut'],
      [2.2, { ...P.armsHigh, 'root.squash': -0.07, 'head.rx': -12, 'lidUpper*': 1, mouthOpen: 0.6, mouthWide: -0.3, smile: 0.2, ...P.earsBack }],
      [2.6, { 'root.squash': 0.06, 'arm*1.rz': 10, 'lidUpper*': 0.2, smile: 0.8 }, 'inOut'],
      [3.3, { ...P.happy, ...P.earsUp }, 'inOut'],
      [3.6, {}, 'inOut'],
    ],
    { tracks: { 'head.ry': [[0, 0], [2.6, 0], ...osc(2.6, 3.2, 5.5, 13).slice(1), [3.6, 0]] }, events: [[1.3, 'sfx', 'yawn']], look: 0.2, idle: 0.1, blink: false, fadeIn: 0.05 },
  );

  CLIPS.earWiggle = clip(
    [[0, {}], [0.15, { ...P.happy, 'head.rz': 5 }], [1.0, { ...P.happy, 'head.rz': 5 }], [1.3, {}]],
    {
      tracks: {
        'earL1.rz': osc(0.1, 1.05, 5, 16), 'earL2.rz': osc(0.1, 1.05, 5, 12, { phase: -0.6 }),
        'earR1.rz': osc(0.1, 1.05, 5, 16, { phase: 3.14 }), 'earR2.rz': osc(0.1, 1.05, 5, 12, { phase: 2.5 }),
      },
      look: 1, idle: 0.5,
    },
  );

  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    CLIPS['earFlick' + side] = clip(
      [
        [0, {}],
        [0.1, { [`ear${side}1.rz`]: -46 * s, [`ear${side}2.rz`]: -30 * s, [`ear${side}1.rx`]: -16, 'head.rz': -11 * s, [`lidUpper${side}`]: 0.9, [`lidLower${side}`]: 0.3, smile: 1, mouthOpen: 0.25 }, 'out'],
        [0.5, { [`ear${side}1.rz`]: -30 * s, [`ear${side}2.rz`]: -18 * s, 'head.rz': -9 * s, [`lidUpper${side}`]: 0.8, [`lidLower${side}`]: 0.3, smile: 1, mouthOpen: 0.2, blush: 0.5 }],
        [0.8, { ...P.happy, 'head.rz': -3 * s }, 'outBack'],
        [1.1, {}, 'inOut'],
      ],
      { tracks: { [`ear${side}3.rz`]: osc(0.1, 0.9, 6, 14 * s) }, look: 0.8, idle: 0.4, blink: false },
    );

    CLIPS['footTickle' + side] = clip(
      [
        [0, {}],
        [0.12, { [`leg${side}1.rx`]: -52, [`leg${side}1.rz`]: 12 * s, [`foot${side}.rx`]: -24, 'hips.rz': 6 * s, 'root.px': -0.03 * s, 'root.py': 0.035, ...P.joy, 'arm*1.rz': 50, 'head.rz': 6 * s }, 'outBack'],
        [0.75, { [`leg${side}1.rx`]: -44, [`leg${side}1.rz`]: 12 * s, [`foot${side}.rx`]: -20, 'hips.rz': 6 * s, 'root.px': -0.03 * s, 'root.py': 0.03, ...P.joy, 'arm*1.rz': 44, 'head.rz': 6 * s }],
        [1.0, { 'root.squash': 0.07, ...P.happy }, 'in'],
        [1.25, {}, 'inOut'],
      ],
      { tracks: { [`foot${side}.rz`]: osc(0.12, 0.8, 6, 14), 'root.squash': osc(0.12, 0.8, 5, 0.03) }, look: 0.6, idle: 0.1, events: [[1.0, 'sfx', 'step']] },
    );

    CLIPS['highFive' + side] = clip(
      [
        [0, {}],
        [0.16, { ...reach(side, [0.2, 0.52, 0.2]), [`arm${side}.len`]: 0, ...P.grin, 'chest.ry': -8 * s }, 'out'],
        [0.3, { ...reach(side, [0.14, 0.62, 0.62]), [`arm${side}.len`]: 1.0, ...P.wow, 'chest.ry': 9 * s, 'chest.rx': 8, 'root.pz': 0.07 }, 'out'],
        [0.38, { ...reach(side, [0.14, 0.62, 0.55]), [`arm${side}.len`]: 0.75, ...P.joy, 'chest.ry': 6 * s, 'chest.rx': 5, 'root.pz': 0.04, 'root.squash': 0.05 }, 'inOut'],
        [0.8, { ...reach(side, [0.16, 0.6, 0.5]), [`arm${side}.len`]: 0.6, ...P.joy, 'chest.ry': 4 * s }],
        [1.15, {}, 'inOut'],
      ],
      { events: [[0.3, 'sfx', 'clap'], [0.3, 'emote', 'star', 3]], look: 1, idle: 0.3 },
    );
  }

  CLIPS.tailSurprise = clip(
    [
      [0, {}],
      [0.1, { 'root.squash': -0.14, 'root.py': 0.1, ...P.armsOut, ...P.gasp, ...P.earsUp, 'tail1.rx': -24, 'tail2.rx': -20 }, 'outBack'],
      [0.32, { 'root.squash': 0.1, 'hips.ry': 16, 'chest.ry': 14, 'head.ry': 30, 'head.rx': 6, ...P.gasp, 'arm*1.rz': 30, gazeX: 0.8, 'tail1.ry': -30, 'tail2.ry': -26 }, 'in'],
      [1.0, { 'hips.ry': 17, 'chest.ry': 14, 'head.ry': 32, 'head.rx': 8, pupil: 0.5, 'browRaise*': 1, mouthOpen: 0.15, gazeX: 0.8, gazeY: -0.3, 'tail1.ry': -34, 'tail2.ry': -30 }],
      [1.45, { ...P.happy, 'head.rz': -6 }, 'inOut'],
      [1.75, {}, 'inOut'],
    ],
    { look: 0, idle: 0.1, blink: false, events: [[0.02, 'sfx', 'pop']] },
  );

  CLIPS.dizzy = clip(
    [
      [0, {}],
      [0.3, { 'lidUpper*': 0.35, pupil: 0.4, mouthOpen: 0.3, mouthWide: -0.5, smile: 0, 'arm*1.rz': 30, 'browRaise*': 0.5 }],
      [2.1, { 'lidUpper*': 0.35, pupil: 0.4, mouthOpen: 0.25, mouthWide: -0.5, smile: 0, 'arm*1.rz': 24 }],
      [2.3, { 'lidUpper*': 1 }, 'inOut'],
      [2.55, { 'head.rx': 0, smile: 0.8 }, 'inOut'],
      [2.9, {}, 'inOut'],
    ],
    {
      tracks: {
        'head.rz': osc(0.2, 2.2, 1.1, 14), 'head.rx': osc(0.2, 2.2, 1.1, 9, { phase: 1.57 }),
        'hips.rz': osc(0.2, 2.2, 1.1, 7, { phase: 0.6 }), 'chest.rx': osc(0.2, 2.2, 1.1, 5, { phase: 2.2 }),
        gazeX: osc(0.2, 2.2, 2.2, 0.85), gazeY: osc(0.2, 2.2, 2.2, 0.85, { phase: 1.57 }),
        'head.ry': [[0, 0], [2.3, 0], ...osc(2.3, 2.8, 6, 10).slice(1), [2.9, 0]],
      },
      look: 0, idle: 0, blink: false, events: [[0.3, 'emote', 'star', 4]],
    },
  );

  CLIPS.aww = clip(
    [
      [0, {}],
      [0.4, { 'head.rx': 14, 'chest.rx': 7, ...P.earsDroop, lidTilt: 0.9, 'lidUpper*': 0.25, smile: -0.8, pout: 0.5, 'browTilt*': 0.5, tear: 0.5, 'arm*1.rz': -14, gazeY: -0.4 }, 'inOut'],
      [1.5, { 'head.rx': 15, 'chest.rx': 8, ...P.earsDroop, lidTilt: 0.9, 'lidUpper*': 0.25, smile: -0.8, pout: 0.5, 'browTilt*': 0.5, tear: 0.8, 'arm*1.rz': -14, gazeY: -0.4 }],
      [2.0, { 'head.rx': 4, smile: 0.4, 'lidUpper*': 0.1 }, 'inOut'],
      [2.3, {}, 'inOut'],
    ],
    { tracks: { pout: osc(0.4, 1.5, 4, 0.2, { base: 0.5 }) }, look: 0.3, idle: 0.3 },
  );

  CLIPS.lookAround = clip(
    [
      [0, {}],
      [0.45, { 'head.ry': 34, 'chest.ry': 10, gazeX: 0.7, 'browRaise*': 0.6, 'ear*1.rz': 5, 'head.rz': -4 }, 'inOut'],
      [1.2, { 'head.ry': 36, 'chest.ry': 10, gazeX: 0.5, 'browRaise*': 0.6, 'head.rz': -4 }],
      [1.75, { 'head.ry': -34, 'chest.ry': -10, gazeX: -0.7, 'browRaise*': 0.6, 'head.rz': 4, 'head.rx': -6, gazeY: 0.4 }, 'inOut'],
      [2.55, { 'head.ry': -36, 'chest.ry': -10, gazeX: -0.5, 'browRaise*': 0.6, 'head.rz': 4, 'head.rx': -8, gazeY: 0.5 }],
      [3.1, {}, 'inOut'],
    ],
    { look: 0, idle: 0.6 },
  );

  CLIPS.sniff = clip(
    [
      [0, {}],
      [0.3, { 'head.rx': -13, 'chest.rx': -4, 'lidUpper*': 0.25, 'browRaise*': 0.7, smile: 0.4, ...P.earsBack }, 'inOut'],
      [1.3, { 'head.rx': -11, 'chest.rx': -4, 'lidUpper*': 0.3, 'browRaise*': 0.7, smile: 0.5, 'head.ry': 12 }],
      [1.7, { ...P.happy }, 'inOut'],
      [2.0, {}, 'inOut'],
    ],
    { tracks: { cheekPuff: osc(0.3, 1.35, 4, 0.2, { base: 0.2 }), 'head.py': osc(0.3, 1.35, 4, 0.006) }, events: [[0.35, 'sfx', 'sniff'], [0.85, 'sfx', 'sniff']], look: 0.1, idle: 0.4 },
  );

  CLIPS.scratchEar = clip(
    [
      [0, {}],
      [0.35, { ...reach('R', [0.26, 0.9, 0.12]), 'head.rz': 14, 'head.ry': -6, lidUpperR: 0.95, lidLowerR: 0.3, smile: 0.9, 'earR1.rz': 14, 'chest.rz': 4 }, 'inOut'],
      [1.6, { ...reach('R', [0.26, 0.9, 0.12]), 'head.rz': 15, 'head.ry': -6, lidUpperR: 0.95, lidLowerR: 0.3, smile: 1, 'earR1.rz': 14, 'chest.rz': 4 }],
      [2.0, { ...P.happy }, 'inOut'],
      [2.3, {}, 'inOut'],
    ],
    { tracks: { 'armR2.rx': osc(0.4, 1.6, 7, 15), 'earR2.rz': osc(0.4, 1.6, 7, 9), 'earR3.rz': osc(0.4, 1.6, 7, 12, { phase: 0.8 }) }, look: 0.3, idle: 0.3, blink: false },
  );

  CLIPS.stretch = clip(
    [
      [0, {}],
      [0.6, { ...P.armsHigh, 'root.squash': -0.1, 'root.py': 0.02, 'head.rx': -12, 'lidUpper*': 1, smile: 0.9, 'chest.rx': -6, ...P.earsBack, 'foot*.rx': 14 }, 'inOut'],
      [1.5, { ...P.armsHigh, 'root.squash': -0.11, 'root.py': 0.02, 'head.rx': -13, 'lidUpper*': 1, smile: 0.9, 'chest.rx': -7, ...P.earsBack, 'foot*.rx': 14 }],
      [1.9, { 'root.squash': 0.07, 'arm*1.rz': -4, 'head.rx': 4, ...P.happy }, 'inOut'],
      [2.3, {}, 'inOut'],
    ],
    { tracks: { 'hips.rz': osc(0.6, 1.5, 1.2, 3) }, look: 0.2, idle: 0.2, blink: false },
  );

  CLIPS.sing = {
    loop: true, look: 0.4, idle: 0.2, dur: 3.2,
    tracks: {
      'hips.rz': [[0, -6, 'sine'], [0.8, 6, 'sine'], [1.6, -6, 'sine'], [2.4, 6, 'sine'], [3.2, -6, 'sine']],
      'head.rz': [[0, 9, 'sine'], [0.8, -9, 'sine'], [1.6, 9, 'sine'], [2.4, -9, 'sine'], [3.2, 9, 'sine']],
      'root.px': [[0, -0.02, 'sine'], [0.8, 0.02, 'sine'], [1.6, -0.02, 'sine'], [2.4, 0.02, 'sine'], [3.2, -0.02, 'sine']],
      'arm*1.rz': [[0, 18, 'sine'], [0.8, 34, 'sine'], [1.6, 18, 'sine'], [2.4, 34, 'sine'], [3.2, 18, 'sine']],
      'arm*1.rx': [[0, -30], [3.2, -30]],
      'lidUpper*': [[0, 0.88], [3.2, 0.88]],
      'lidLower*': [[0, 0.3], [3.2, 0.3]],
      smile: [[0, 0.9], [3.2, 0.9]],
      blush: [[0, 0.3], [3.2, 0.3]],
      'head.rx': [[0, -5], [3.2, -5]],
    },
    events: [[0.2, 'emote', 'note', 1], [1.8, 'emote', 'note', 1]],
  };

  CLIPS.point = clip(
    [
      [0, {}],
      [0.14, { 'root.squash': 0.07, 'armL1.rz': 30 }, 'out'],
      [0.32, { ...reach('L', [0.52, 0.9, 0.2], 0.8), 'root.squash': -0.07, 'root.py': 0.05, ...P.wow, mouthOpen: 0.5, 'head.rz': 6, 'hips.rz': -4 }, 'outBack'],
      [0.62, { ...reach('L', [0.52, 0.86, 0.2], 0.7), ...P.happy, mouthOpen: 0.2, 'head.rz': 5, 'hips.rz': -3 }],
      [0.9, {}, 'inOut'],
    ],
    { look: 1, idle: 0.4, events: [[0.3, 'emote', 'star', 1]] },
  );

  CLIPS.think = clip(
    [
      [0, {}],
      [0.4, { ...reach('R', [0.07, 0.585, 0.395]), 'head.rz': 12, 'head.rx': -6, gazeX: -0.6, gazeY: 0.75, 'browRaiseL': 1, browTiltR: -0.3, smile: 0.2, pout: 0.5, 'hips.rz': 3 }, 'inOut'],
      [1.8, { ...reach('R', [0.07, 0.585, 0.395]), 'head.rz': 13, 'head.rx': -7, gazeX: 0.5, gazeY: 0.75, 'browRaiseL': 1, browTiltR: -0.3, smile: 0.2, pout: 0.5, 'hips.rz': 3 }],
      [2.1, { ...P.wow, 'armR1.rz': -60 }, 'outBack'],
      [2.5, {}, 'inOut'],
    ],
    { look: 0, idle: 0.4 },
  );

  CLIPS.bow = clip(
    [
      [0, {}],
      [0.4, { 'chest.rx': 30, 'hips.rx': 14, 'head.rx': 16, ...P.armsBack, 'arm*1.rz': 14, 'lidUpper*': 1, smile: 1, ...P.earsFwd }, 'inOut'],
      [0.85, { 'chest.rx': 30, 'hips.rx': 14, 'head.rx': 16, ...P.armsBack, 'arm*1.rz': 14, 'lidUpper*': 1, smile: 1, ...P.earsFwd }],
      [1.25, { ...P.happy }, 'outBack'],
      [1.5, {}, 'inOut'],
    ],
    { look: 0.2, idle: 0.3 },
  );

  CLIPS.bellyRub = clip(
    [
      [0, {}],
      [0.3, { ...P.pawsTummy, ...P.joy, mouthOpen: 0.2, 'chest.rx': -4, 'head.rx': -5 }, 'inOut'],
      [1.6, { ...P.pawsTummy, ...P.joy, mouthOpen: 0.15, 'chest.rx': -4, 'head.rx': -5 }],
      [2.0, {}, 'inOut'],
    ],
    {
      tracks: {
        'armL1.ry': [[0, 0], ...osc(0.3, 1.6, 2.2, 9, { base: P.pawsTummy['armL1.ry'] }), [2.0, 0]],
        'armR1.ry': [[0, 0], ...osc(0.3, 1.6, 2.2, 9, { base: P.pawsTummy['armR1.ry'] }), [2.0, 0]],
        'hips.rz': osc(0.3, 1.6, 1.1, 4), 'head.rz': osc(0.3, 1.6, 1.1, 6, { phase: 1 }),
      },
      look: 0.6, idle: 0.3,
    },
  );

  CLIPS.wiggle = clip(
    [
      [0, {}],
      [0.15, { 'root.squash': 0.13, 'chest.rx': 12, 'head.rx': -8, ...P.grin, 'arm*1.rz': 20, 'arm*1.rx': 20 }, 'out'],
      [1.0, { 'root.squash': 0.13, 'chest.rx': 12, 'head.rx': -8, ...P.grin, 'arm*1.rz': 20, 'arm*1.rx': 20 }],
      [1.2, {}, 'outBack'],
    ],
    { tracks: { 'hips.ry': osc(0.15, 1.0, 5, 14), 'tail1.ry': osc(0.15, 1.0, 5, 26, { phase: 1 }), 'tail2.ry': osc(0.15, 1.0, 5, 30, { phase: 0.4 }) }, look: 1, idle: 0.2 },
  );

  CLIPS.raspberry = clip(
    [
      [0, {}],
      [0.18, { tongue: 1, 'lidUpper*': 0.9, 'lidLower*': 0.4, smile: 1, 'head.rx': 6, 'chest.rx': 8, 'arm*1.rz': 30, blush: 0.4 }, 'outBack'],
      [1.0, { tongue: 1, 'lidUpper*': 0.9, 'lidLower*': 0.4, smile: 1, 'head.rx': 7, 'chest.rx': 8, 'arm*1.rz': 26, blush: 0.4 }],
      [1.25, { ...P.joy }, 'inOut'],
      [1.6, {}, 'inOut'],
    ],
    { tracks: { 'head.ry': osc(0.2, 1.0, 6, 6), cheekPuff: osc(0.2, 1.0, 9, 0.15, { base: 0.25 }) }, events: [[0.2, 'sfx', 'raspberry']], look: 1, idle: 0.2, blink: false },
  );

  CLIPS.talkGesture1 = clip(
    [[0, {}], [0.3, { 'armL1.rz': 52, 'armL2.rz': 30, 'head.rz': 6, 'browRaise*': 0.6 }, 'outBack'], [0.9, { 'armL1.rz': 46, 'armL2.rz': 24, 'head.rz': 5 }], [1.3, {}, 'inOut']],
    { look: 1, idle: 0.8, additive: false },
  );
  CLIPS.talkGesture2 = clip(
    [[0, {}], [0.3, { 'arm*1.rz': 48, 'arm*2.rz': 26, 'chest.rx': -3, 'browRaise*': 0.8, 'root.py': 0.015 }, 'outBack'], [0.9, { 'arm*1.rz': 42, 'arm*2.rz': 22, 'chest.rx': -2 }], [1.3, {}, 'inOut']],
    { look: 1, idle: 0.8 },
  );
  CLIPS.talkGesture3 = clip(
    [[0, {}], [0.25, { 'head.rz': -9, 'hips.rz': 4, ...reach('R', [0.09, 0.5, 0.3]), 'browRaise*': 0.4 }, 'inOut'], [0.95, { 'head.rz': -8, 'hips.rz': 4, ...reach('R', [0.09, 0.5, 0.3]) }], [1.35, {}, 'inOut']],
    { look: 1, idle: 0.8 },
  );

  // a soft, additive bounce: layered on top of anything when Lumi is poked
  CLIPS.poke = {
    additive: true, fadeIn: 0.001, fadeOut: 0.15, look: 1, idle: 1,
    tracks: {
      'root.squash': [[0, 0], [0.07, 0.13, 'out'], [0.2, -0.06, 'inOut'], [0.33, 0.03, 'inOut'], [0.46, 0, 'inOut']],
      'head.rx': [[0, 0], [0.07, 5, 'out'], [0.22, -3, 'inOut'], [0.46, 0, 'inOut']],
    },
  };
  CLIPS.plop = {
    additive: true, fadeIn: 0.001, fadeOut: 0.2, look: 1, idle: 1,
    tracks: {
      'root.squash': [[0, 0], [0.12, -0.05, 'out'], [0.3, 0.2, 'in'], [0.46, -0.05, 'out'], [0.62, 0.03, 'inOut'], [0.8, 0, 'inOut']],
      'root.py': [[0, 0], [0.12, 0.05, 'out'], [0.3, 0, 'in'], [0.8, 0]],
    },
    events: [[0.3, 'sfx', 'land'], [0.3, 'puff']],
  };
  // startled little shiver, e.g. when a butterfly lands
  CLIPS.shiver = {
    additive: true, fadeIn: 0.05, fadeOut: 0.2, look: 1, idle: 1,
    tracks: { 'hips.ry': osc(0, 0.6, 11, 5), 'head.ry': osc(0, 0.6, 11, 4, { phase: 1 }), 'root.squash': [[0, 0], [0.1, -0.05], [0.6, 0]] },
  };

  return { CLIPS, STANCES, EXPRESSIONS };
}
