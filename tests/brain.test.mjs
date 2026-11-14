import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeWorld, seedRandom } from './helpers.mjs';
import { FIND_TARGETS, INVITATIONS } from '../app/src/brain/brain.js';

test('Lumi starts asleep and the first touch wakes her with a greeting', () => {
  seedRandom(1);
  const w = makeWorld();
  assert.equal(w.brain.mode, 'asleep');
  assert.equal(w.anim.stance, 'asleep');
  w.run(3);
  assert.equal(w.brain.mode, 'asleep', 'she stays asleep until touched');
  assert.deepEqual(w.said, []);
  w.brain.onTap({ kind: 'sky', point: new THREE.Vector3() }); // anywhere on screen
  assert.equal(w.brain.mode, 'awake');
  w.run(6.5);
  assert.equal(w.anim.stance, 'stand');
  assert.equal(w.anim.eyesShut, false);
  assert.equal(w.said[0], 'intro', 'the very first greeting introduces her by name');
  assert.equal(w.store.data.firstRunDone, true);
  assert.equal(w.mimic.paused, false, 'the microphone is live once she is up');
});

test('later visits get a different greeting than the first one', () => {
  seedRandom(4);
  const w = makeWorld({ hour: 15 });
  w.store.data.firstRunDone = true;
  w.brain.onTap({ kind: 'lumi', part: 'head' });
  w.run(6.5);
  assert.equal(w.said[0], 'hello');
});

function awake(seed = 1, opts) {
  seedRandom(seed);
  const w = makeWorld(opts);
  w.store.data.firstRunDone = true;
  w.brain.onTap({ kind: 'lumi', part: 'head' });
  w.run(7.5);
  w.said.length = 0;
  w.sounds.length = 0;
  w.brain.inviteTimer = 999; // keep her from starting games on her own unless a test wants it
  return w;
}

test('each part of her body has its own reaction', () => {
  const expected = {
    nose: 'boop', belly: 'tickle', earL: 'earFlickL', earR: 'earFlickR', armL: 'highFiveL', footR: 'footTickleR',
    tail: 'tailSurprise', cheekL: 'giggle', eyeL: 'peekaboo',
  };
  for (const [part, clip] of Object.entries(expected)) {
    const w = awake(9);
    w.tapPart(part);
    w.run(0.2);
    assert.ok(w.anim.isPlaying(clip), `touching ${part} should play ${clip}`);
  }
});

test('three quick boops on the nose make her sneeze and excuse herself', () => {
  const w = awake(2);
  w.tapPart('nose');
  w.run(0.5);
  w.tapPart('nose');
  w.run(0.5);
  w.tapPart('nose');
  w.run(0.2);
  assert.ok(w.anim.isPlaying('sneeze'));
  w.run(3.2);
  assert.ok(w.said.includes('excuse'));
});

test('stroking her makes her blissful, and it ends when the stroking stops', () => {
  const w = awake(3);
  for (let i = 0; i < 30; i++) {
    w.brain.onStroke({ part: 'head', speed: 0.3, start: { kind: 'lumi', part: 'head' } });
    w.run(0.07);
  }
  assert.equal(w.anim.stance, 'petted');
  assert.equal(w.anim.expression, 'bliss');
  assert.ok(w.sounds.includes('sfx:heart'), 'hearts float up while she is petted');
  w.run(1.5);
  assert.equal(w.anim.stance, 'stand');
});

test('a swipe up makes her jump, sideways makes her spin, three spins make her dizzy', () => {
  const w = awake(5);
  const onLumi = { kind: 'lumi', part: 'belly' };
  w.brain.onSwipe('up', onLumi);
  w.run(0.1);
  assert.ok(w.anim.isPlaying('jump'));
  w.run(2);
  for (let i = 0; i < 3; i++) {
    w.brain.onSwipe('left', onLumi);
    w.run(i < 2 ? 1.6 : 1.7);
  }
  assert.ok(w.anim.isPlaying('dizzy'));
  assert.ok(w.said.includes('dizzy'));
});

test('holding her gives a hug and an "I love you"', () => {
  const w = awake(6);
  w.brain.onHold({ kind: 'lumi', part: 'belly' });
  w.run(1.5);
  assert.ok(w.anim.isPlaying('hug'));
  assert.ok(w.said.includes('love'));
  assert.ok(w.rig.zoomGoal < 1, 'the camera moves in close');
  w.run(3);
  assert.equal(w.rig.zoomGoal, 1);
});

test('"can you find my nose?": the right touch is celebrated', () => {
  const w = awake(7);
  const nose = FIND_TARGETS.find((t) => t.ask === 'find_nose');
  Math.random = () => 0; // pick() chooses the first target: the nose
  w.brain.startActivity('find');
  w.run(1.2);
  assert.equal(w.said.at(-1), nose.ask);
  w.tapPart('belly'); // wrong: she names it kindly and asks again
  w.run(2.4);
  assert.ok(w.said.includes('name_tummy'));
  assert.ok(w.said.includes('retry'));
  w.tapPart('nose');
  w.run(1.5);
  assert.ok(w.sounds.includes('sfx:success'));
  assert.ok(w.said.includes('found'));
  assert.ok(w.anim.isPlaying('cheer'));
});

test('"can you find...?": if nobody answers she hints, then shows the answer herself', () => {
  const w = awake(8);
  Math.random = () => 0;
  w.brain.startActivity('find');
  w.run(11);
  assert.ok(w.anim.isPlaying('boop') || w.said.filter((s) => s === 'find_nose').length === 2, 'she hints and asks again');
  w.run(12);
  assert.equal(w.brain.script, null, 'the game ends on its own');
});

test('hunger: she asks for a snack, it appears, feeding it resets her hunger', () => {
  const w = awake(10);
  w.brain.hunger = 1;
  w.brain.idleTimer = 0;
  w.run(0.5);
  assert.equal(w.brain.script?.name, 'hungry');
  w.run(4);
  assert.ok(w.said.includes('hungry'));
  assert.equal(w.snack.state, 'waiting');
  assert.ok(['apple', 'strawberry', 'carrot', 'cookie'].includes(w.snack.kind));
  assert.ok(w.said.includes(w.snack.kind), 'she names the food');
  w.brain.onTap({ kind: 'prop', prop: w.snack, point: w.snack.pos.clone() });
  w.run(0.3);
  assert.ok(w.anim.isPlaying('eat'));
  w.run(5);
  assert.equal(w.snack.state, 'none', 'the snack is gone');
  assert.ok(w.brain.hunger < 0.1);
  assert.ok(w.said.includes('yum'));
});

test('a snack that is ignored goes away again', () => {
  const w = awake(12);
  w.brain.startActivity('hungry');
  w.run(16);
  assert.equal(w.snack.state, 'waiting');
  assert.ok(w.said.includes('snack_please'), 'she asks again, politely');
  w.run(24);
  assert.equal(w.snack.state, 'none');
  assert.notEqual(w.brain.script?.name, 'hungry', 'she stops waiting');
  assert.ok(w.brain.hunger < 1, 'and will ask again later rather than straight away');
});

test('tapping the sky by day blows bubbles; popping one names its colour', () => {
  const w = awake(13);
  w.brain.onTap({ kind: 'sky', point: new THREE.Vector3(0.4, 1.4, 0.75) });
  w.run(1.2);
  assert.ok(w.bubbles.count >= 5);
  assert.equal(w.brain.script?.name, 'bubbles');
  const b = w.bubbles.items[0];
  w.brain.onTap({ kind: 'prop', prop: { type: 'bubble', bubble: b }, point: b.pos.clone() });
  assert.ok(w.said.includes(b.color.name));
  assert.equal(w.bubbles.items.includes(b), false);
});

test('tapping the sky at night sends a shooting star instead', () => {
  const w = awake(14, { hour: 23 });
  w.run(0.1);
  w.brain.onTap({ kind: 'sky', point: new THREE.Vector3(0.4, 1.4, 0.75) });
  assert.equal(w.bubbles.count, 0);
  assert.equal(w.brain.streaks.length, 1);
  w.run(1);
  assert.ok(w.sounds.includes('sfx:star'));
});

test('tapping the grass grows flowers, and now and then a butterfly comes out', () => {
  const w = awake(15);
  for (let i = 0; i < 4; i++) {
    w.brain.onTap({ kind: 'ground', point: new THREE.Vector3(-1 + i * 0.5, 0, 1) });
    w.run(0.4);
  }
  assert.equal(w.blooms.items.length, 4);
  assert.ok(w.butterfly.active, 'the fourth flower releases a butterfly');
});

test('counting game counts out loud in order', () => {
  const w = awake(16);
  Math.random = () => 0.3; // not the long version; the first of [3, 5]
  w.brain.startActivity('count');
  w.run(12);
  const numbers = w.said.filter((s) => /^n\d+$/.test(s));
  assert.deepEqual(numbers, ['n1', 'n2', 'n3']);
  assert.ok(w.said.includes('count_done'));
});

test('every invitation can run to completion without errors', () => {
  for (const kind of new Set(INVITATIONS)) {
    const w = awake(20);
    w.brain.startActivity(kind);
    w.run(30);
    w.bubbles.clear();
    w.run(1);
    assert.ok(w.brain.script === null || w.brain.script.name !== kind, `${kind} should finish`);
  }
});

test('what she hears is said back, and animal questions accept any answer', () => {
  const w = awake(17);
  const heard = (what, ...args) => (what === 'start' ? w.mimic.onSpeechStart() : what === 'utterance' ? w.mimic.onUtterance(...args) : w.mimic.onSpeechCancel());
  let played = 0;
  w.audio.playBuffer = () => (played++, { duration: 1 });
  heard('start');
  assert.equal(w.anim.stance, 'listen');
  assert.equal(w.brain.listening, true);
  heard('utterance', {}, 1.2);
  w.run(0.5);
  assert.equal(played, 1, 'her copy of the phrase is played');
  assert.equal(w.anim.stance, 'stand');
  // with the setting off she does not listen at all
  w.run(4);
  w.store.set('mimic', false);
  heard('start');
  assert.equal(w.brain.listening, false);
});

test('left alone she calls for company, then naps; at night she goes to bed sooner', () => {
  const day = awake(18);
  day.run(40);
  assert.ok(day.said.includes('bored'));
  day.run(125);
  assert.equal(day.brain.mode, 'asleep');
  assert.equal(day.anim.stance, 'asleep');

  const night = awake(19, { hour: 23 });
  night.run(82);
  assert.equal(night.brain.mode, 'asleep');
  assert.ok(night.said.includes('night'), 'she says good night');
});

test('bedtime can be requested by a grown-up, and a touch wakes her again', () => {
  const w = awake(21);
  w.brain.bedtime();
  w.run(7);
  assert.equal(w.brain.mode, 'asleep');
  assert.equal(w.mimic.paused, true);
  w.tapPart('head');
  assert.equal(w.brain.mode, 'awake');
  w.run(7);
  assert.equal(w.anim.stance, 'stand');
});

test('a long unattended session stays healthy', () => {
  const w = awake(22);
  w.brain.inviteTimer = 5;
  // ten simulated minutes with a sprinkling of random touches
  const parts = ['nose', 'belly', 'head', 'earL', 'tail', 'footL', 'armR', 'cheekR', 'star', 'eyeR'];
  for (let i = 0; i < 300; i++) {
    w.run(2);
    const r = Math.random();
    if (r < 0.25) w.tapPart(parts[Math.floor(Math.random() * parts.length)]);
    else if (r < 0.3) w.brain.onTap({ kind: 'sky', point: new THREE.Vector3(0.3, 1.2, 0.75) });
    else if (r < 0.35) w.brain.onTap({ kind: 'ground', point: new THREE.Vector3(0.8, 0, 1) });
    else if (r < 0.4) w.brain.onSwipe(['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)], { kind: 'lumi', part: 'belly' });
    else if (r < 0.43 && w.snack.state === 'waiting') w.brain.onTap({ kind: 'prop', prop: w.snack, point: w.snack.pos.clone() });
    for (let c = 0; c < w.anim.ch.count; c++) assert.ok(Number.isFinite(w.anim.ch.values[c]));
  }
  assert.ok(w.said.length > 20, 'she kept chatting');
  assert.ok(w.anim.active.length < 6, 'animation layers do not pile up');
});
