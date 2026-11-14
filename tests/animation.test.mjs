import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fakeLumi, seedRandom } from './helpers.mjs';
import { Animator } from '../app/src/anim/animator.js';
import { expandChannel } from '../app/src/anim/channels.js';
import { EASE } from '../app/src/anim/easing.js';

test('symmetric channels mirror yaw and roll for the right side', () => {
  assert.deepEqual(expandChannel('head.rx'), [{ name: 'head.rx', sign: 1 }]);
  assert.deepEqual(expandChannel('arm*1.rz'), [{ name: 'armL1.rz', sign: 1 }, { name: 'armR1.rz', sign: -1 }]);
  assert.deepEqual(expandChannel('arm*1.rx'), [{ name: 'armL1.rx', sign: 1 }, { name: 'armR1.rx', sign: 1 }]);
  assert.deepEqual(expandChannel('lidUpper*'), [{ name: 'lidUpperL', sign: 1 }, { name: 'lidUpperR', sign: 1 }]);
});

test('easing curves start at 0 and end at 1', () => {
  for (const [name, fn] of Object.entries(EASE)) {
    assert.ok(Math.abs(fn(0)) < 1e-9, `${name}(0)`);
    assert.ok(Math.abs(fn(1) - 1) < 1e-9, `${name}(1)`);
  }
});

test('every clip compiles and plays through without producing bad numbers', () => {
  seedRandom(7);
  const lumi = fakeLumi();
  const anim = new Animator(lumi);
  const names = Object.keys(anim.clips);
  assert.ok(names.length >= 45, `expected a rich repertoire, found ${names.length} clips`);
  for (const name of names) {
    const clip = anim.clips[name];
    assert.ok(clip.dur > 0.2 && clip.dur < 6, `${name} duration ${clip.dur}`);
    const inst = anim.play(name);
    const steps = Math.ceil((Math.min(clip.dur, 4) + 0.6) * 30);
    for (let i = 0; i < steps; i++) {
      anim.update(1 / 30);
      for (let c = 0; c < anim.ch.count; c++) assert.ok(Number.isFinite(anim.ch.values[c]), `${name}: channel ${anim.ch.names[c]} is not finite`);
    }
    for (const bone of lumi.boneList) {
      for (const e of bone.matrixWorld.elements) assert.ok(Number.isFinite(e), `${name}: bone ${bone.name} matrix`);
    }
    anim.stop(inst);
    anim.stopAll();
    for (let i = 0; i < 20; i++) anim.update(1 / 30);
  }
});

test('clips return the body to rest: nothing is left twisted afterwards', () => {
  seedRandom(3);
  const lumi = fakeLumi();
  const anim = new Animator(lumi);
  anim.energy = 0; // no idle motion, so "rest" is exact
  anim.lookAmount = 0;
  anim.eyesShut = true;
  for (const name of ['jump', 'spin', 'giggle', 'hug', 'peekaboo', 'eat', 'sneeze']) {
    anim.play(name);
    for (let i = 0; i < (anim.clips[name].dur + 1.2) * 60; i++) anim.update(1 / 60);
    const ix = anim.ch.index, v = anim.ch.values;
    assert.ok(Math.abs(v[ix['root.py']]) < 1e-3, `${name}: feet back on the ground`);
    assert.ok(Math.abs(v[ix['root.squash']]) < 1e-3, `${name}: no leftover squash`);
    const yaw = ((v[ix['root.ry']] % 360) + 360) % 360;
    assert.ok(yaw < 0.5 || yaw > 359.5, `${name}: facing forward again (yaw ${yaw})`);
    assert.equal(anim.active.length, 0, `${name}: clip finished`);
  }
});

test('reaching poses actually bring the paws where they should be', () => {
  seedRandom(5);
  const lumi = fakeLumi();
  const anim = new Animator(lumi);
  const hand = new THREE.Vector3();
  const check = (clip, t, target, tol) => {
    anim.debugPose(clip, t);
    anim.update(0);
    for (const side of ['L', 'R']) {
      lumi.anchorWorld('hand' + side, hand);
      const want = new THREE.Vector3(side === 'L' ? target[0] : -target[0], target[1], target[2]);
      const d = hand.distanceTo(want);
      assert.ok(d < tol, `${clip}: ${side} paw is ${d.toFixed(3)} from its target`);
    }
  };
  check('giggle', 0.5, [0.075, 0.6, 0.385], 0.09); // paws to mouth
  check('clap', 0.34, [0.035, 0.43, 0.34], 0.09); // paws meet in the middle
  check('peekaboo', 1.0, [0.15, 0.755, 0.365], 0.16); // paws over eyes (head is bowed, arms stretch)
});

test('blinking closes both eyes briefly and they reopen', () => {
  seedRandom(11);
  const lumi = fakeLumi();
  const anim = new Animator(lumi);
  let closedFrames = 0, maxLid = 0;
  for (let i = 0; i < 30 * 30; i++) {
    anim.update(1 / 30);
    const lid = anim.ch.get('lidUpperL');
    maxLid = Math.max(maxLid, lid);
    if (lid > 0.9) closedFrames++;
  }
  assert.ok(maxLid > 0.9, 'she blinked at least once in 30 seconds');
  assert.ok(closedFrames < 30 * 30 * 0.12, 'eyes are open most of the time');
});

test('her head and eyes follow a point of interest', () => {
  seedRandom(2);
  const lumi = fakeLumi();
  const anim = new Animator(lumi);
  anim.energy = 0;
  anim.lookAt(new THREE.Vector3(2, 0.8, 2), 10); // off to her left
  for (let i = 0; i < 60; i++) anim.update(1 / 30);
  assert.ok(anim.ch.get('head.ry') > 8, 'head turned toward it');
  assert.ok(anim.ch.get('gazeX') > 0.2, 'eyes turned toward it');
  anim.lookAt(new THREE.Vector3(-2, 0.8, 2), 10);
  for (let i = 0; i < 60; i++) anim.update(1 / 30);
  assert.ok(anim.ch.get('head.ry') < -8 && anim.ch.get('gazeX') < -0.2, 'and back the other way');
});

test('speech opens the mouth in time with the voice', () => {
  const lumi = fakeLumi();
  const anim = new Animator(lumi);
  anim.speech.level = 0.9;
  for (let i = 0; i < 10; i++) anim.update(1 / 60);
  assert.ok(anim.ch.get('mouthOpen') > 0.5);
  anim.speech.level = 0;
  for (let i = 0; i < 30; i++) anim.update(1 / 60);
  assert.ok(anim.ch.get('mouthOpen') < 0.05);
});
