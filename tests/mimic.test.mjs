import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mimic } from '../app/src/audio/mimic.js';

const RATE = 44100, BLOCK = 1024;

function setup() {
  const engine = {
    speaking: false,
    ctx: { sampleRate: RATE, createBuffer: (ch, len, rate) => ({ length: len, duration: len / rate, data: null, copyToChannel(d) { this.data = d; } }) },
  };
  const m = new Mimic(engine);
  const events = [];
  m.onSpeechStart = () => events.push(['start']);
  m.onSpeechCancel = () => events.push(['cancel']);
  m.onUtterance = (buffer, seconds) => events.push(['utterance', buffer, seconds]);
  /** Feed `seconds` of a tone at amplitude `amp` (0 = silence, with a little hiss). */
  const feed = (seconds, amp) => {
    const blocks = Math.round((seconds * RATE) / BLOCK);
    for (let b = 0; b < blocks; b++) {
      const block = new Float32Array(BLOCK);
      for (let i = 0; i < BLOCK; i++) block[i] = amp * Math.sin((b * BLOCK + i) * 0.06) + (Math.random() - 0.5) * 0.002;
      m.feed(block);
    }
  };
  return { m, engine, events, feed };
}

test('a spoken phrase is captured from just before it starts to just after it ends', () => {
  const { events, feed } = setup();
  feed(1.0, 0);
  assert.deepEqual(events, [], 'silence triggers nothing');
  feed(0.8, 0.2);
  assert.equal(events[0][0], 'start');
  feed(1.0, 0);
  assert.equal(events.length, 2);
  const [type, buffer, seconds] = events[1];
  assert.equal(type, 'utterance');
  // 0.8 s of speech plus a little lead-in and tail, not the whole trailing silence
  assert.ok(seconds > 0.85 && seconds < 1.45, `captured ${seconds.toFixed(2)} s`);
  let peak = 0;
  for (const s of buffer.data) peak = Math.max(peak, Math.abs(s));
  assert.ok(peak > 0.7 && peak <= 0.81, `normalised to a comfortable level (peak ${peak.toFixed(2)})`);
});

test('quiet speech is boosted, but never by more than a safe amount', () => {
  const { events, feed } = setup();
  feed(1.0, 0);
  feed(0.6, 0.03);
  feed(1.0, 0);
  const [, buffer] = events.at(-1);
  let peak = 0;
  for (const s of buffer.data) peak = Math.max(peak, Math.abs(s));
  assert.ok(peak > 0.2 && peak <= 0.81);
});

test('a brief click or bump is not treated as speech', () => {
  const { events, feed } = setup();
  feed(1.0, 0);
  feed(0.1, 0.3);
  feed(1.2, 0);
  assert.deepEqual(events.map((e) => e[0]), ['start', 'cancel']);
});

test('the microphone is ignored while Lumi herself is speaking', () => {
  const { events, engine, feed } = setup();
  feed(0.5, 0);
  engine.speaking = true;
  feed(1.0, 0.3);
  assert.deepEqual(events, []);
  engine.speaking = false;
  feed(0.6, 0);
  feed(0.7, 0.3);
  feed(1.0, 0);
  assert.deepEqual(events.map((e) => e[0]), ['start', 'utterance']);
});

test('very long talking is cut into a phrase of at most seven seconds', () => {
  const { events, feed } = setup();
  feed(0.5, 0);
  feed(9, 0.2);
  const first = events.find((e) => e[0] === 'utterance');
  assert.ok(first, 'a phrase was produced');
  assert.ok(first[2] <= 7.05);
});

test('steady background noise raises the bar instead of triggering', () => {
  const { events, feed } = setup();
  feed(12, 0.012); // a fan, a car, a TV in the next room
  assert.deepEqual(events.filter((e) => e[0] === 'utterance'), []);
});

// ---- starting and stopping the microphone ----------------------------------------------

/** A fake browser: getUserMedia waits until the test grants it, like a permission prompt. */
function fakeBrowser() {
  const requests = [];
  const streams = [];
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: () =>
        new Promise((resolve, reject) => {
          const track = { live: true, stop() { this.live = false; } };
          const stream = { getTracks: () => [track], track };
          requests.push({ grant: () => (streams.push(stream), resolve(stream)), deny: () => reject(new Error('denied')) });
        }),
    },
  });
  const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1 } });
  const engine = {
    speaking: false,
    ctx: { sampleRate: RATE, destination: {}, createGain: node, createMediaStreamSource: node, createScriptProcessor: node },
  };
  const live = () => streams.filter((s) => s.track.live).length;
  return { mimic: new Mimic(engine), requests, streams, live };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('the microphone is released when stopped, and picked up again on start', async () => {
  const { mimic, requests, live } = fakeBrowser();
  mimic.start();
  requests[0].grant();
  await settle();
  assert.equal(mimic.state, 'listening');
  assert.equal(live(), 1);
  mimic.stop();
  assert.equal(mimic.state, 'off');
  assert.equal(live(), 0, 'no microphone stays open after stop()');
  mimic.start();
  requests[1].grant();
  await settle();
  assert.equal(mimic.state, 'listening');
  assert.equal(live(), 1);
});

test('stopping while the permission prompt is up never leaves the microphone open', async () => {
  const { mimic, requests, live } = fakeBrowser();
  mimic.start(); // prompt appears...
  mimic.stop(); // ...and the app goes off screen before anyone answers
  requests[0].grant();
  await settle();
  assert.equal(mimic.state, 'off');
  assert.equal(live(), 0);
});

test('a late answer to an old prompt cannot steal the live microphone (hide/show during the prompt)', async () => {
  const { mimic, requests, live } = fakeBrowser();
  mimic.start(); // request #1: the permission prompt hides the app
  mimic.stop(); // page hidden
  mimic.start(); // page shown again: request #2
  requests[0].grant(); // the old request is answered first
  await settle();
  requests[1].grant();
  await settle();
  assert.equal(mimic.state, 'listening');
  assert.equal(live(), 1, 'exactly one microphone stream is open');
  mimic.stop(); // and it really is the one that gets released
  assert.equal(live(), 0, 'nothing is left recording after stop()');
});

test('a refused prompt is reported, but not if the request was already abandoned', async () => {
  const a = fakeBrowser();
  a.mimic.start();
  a.requests[0].deny();
  await settle();
  assert.equal(a.mimic.state, 'denied');
  const b = fakeBrowser();
  b.mimic.start();
  b.mimic.stop();
  b.requests[0].deny();
  await settle();
  assert.equal(b.mimic.state, 'off');
});
