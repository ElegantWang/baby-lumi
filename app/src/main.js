// Lumi: a gentle talking companion. This file wires the pieces together.
import * as THREE from 'three';
import { Engine, TIERS } from './engine/engine.js';
import { World } from './world/world.js';
import { loadCharacter } from './character/loader.js';
import { Lumi } from './character/lumi.js';
import { Animator } from './anim/animator.js';
import { AudioEngine } from './audio/engine.js';
import { Vocal } from './audio/vocal.js';
import { Sfx, Ambience } from './audio/sfx.js';
import { VoiceLines } from './audio/voiceLines.js';
import { Mimic } from './audio/mimic.js';
import { Emotes } from './fx/emotes.js';
import { Snack } from './props/food.js';
import { Bubbles } from './props/bubbles.js';
import { Butterfly } from './props/butterfly.js';
import { Blooms } from './props/blooms.js';
import { Input } from './input/input.js';
import { Brain } from './brain/brain.js';
import { Store } from './brain/store.js';
import { ParentPanel } from './ui/parent.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage');
const store = new Store();

if (!document.createElement('canvas').getContext('webgl2')) {
  document.getElementById('veil').innerHTML =
    '<p style="font:600 20px/1.5 system-ui,sans-serif;color:#5a3fa0;text-align:center;padding:2em;max-width:26em">Lumi needs a newer browser to come out and play. Please update this device or try another browser.</p>';
  throw new Error('WebGL2 is not available');
}

// ---- world and character -------------------------------------------------------
const scene = new THREE.Scene();
const world = new World();
scene.add(world.group);

const asset = await loadCharacter('assets/lumi.bin');
const lumi = new Lumi(asset, world.env, { shells: 20 });
scene.add(lumi.group);
const animator = new Animator(lumi);

const emotes = new Emotes();
const snack = new Snack(world.env);
const bubbles = new Bubbles(world.env);
const butterfly = new Butterfly(world.env);
const blooms = new Blooms(world.env);
scene.add(emotes.mesh, snack.mesh, bubbles.mesh, butterfly.mesh, blooms.mesh);

// ---- renderer --------------------------------------------------------------------
const fixedQuality = params.get('q') || (store.settings.quality !== 'auto' ? store.settings.quality : undefined);
const engine = new Engine(canvas, {
  quality: fixedQuality,
  onQuality: (tier) => {
    lumi.setShellCount(tier.shells);
    world.setGrassDensity(tier.grass);
    for (const l of [world.env.keyLight, world.env.sunLight]) {
      l.shadow.mapSize.set(tier.shadow, tier.shadow);
      l.shadow.map?.dispose();
      l.shadow.map = null;
    }
  },
});
addEventListener('resize', () => engine.resize());
addEventListener('orientationchange', () => setTimeout(() => engine.resize(), 250));

// ---- sound ------------------------------------------------------------------------
const audio = new AudioEngine();
audio.setVolume(store.settings.volume);
const vocal = new Vocal(audio);
const sfx = new Sfx(audio);
const ambience = new Ambience(audio);
ambience.enabled = store.settings.ambience;
const voice = new VoiceLines(audio);
// her giggles and other wordless sounds, in the same voice; speaking hushes them
const sounds = new VoiceLines(audio);
sounds.setLanguage('sounds');
vocal.recordings = sounds;
voice.quiets.push(sounds);
// Lumi speaks the device's language when she can, unless a grown-up picked one (or ?lang= says otherwise)
const chosenLanguage = () => voice.resolve(params.get('lang') || store.settings.lang);
function applyLanguage() {
  const code = chosenLanguage();
  document.documentElement.lang = code;
  return voice.setLanguage(code);
}
voice.init().then(applyLanguage);
const mimic = new Mimic(audio);

// ---- input and behaviour ---------------------------------------------------------
const input = new Input(canvas, engine.camera, lumi);
input.propPickers.push(
  (o, d) => snack.pick(o, d),
  (o, d) => bubbles.pick(o, d),
  (o, d) => butterfly.pick(o, d),
);
const brain = new Brain({
  lumi, anim: animator, rig: engine.rig, env: world.env, audio, vocal, sfx, voice, emotes,
  snack, bubbles, butterfly, blooms, mimic, store, input,
});
brain.onAudioReady = () => {
  ambience.start();
  if (store.settings.mimic && !params.has('nomic')) mimic.start();
};

// ---- time of day ------------------------------------------------------------------
function applyTime() {
  if (params.has('hour')) return world.env.setHour(Number(params.get('hour')));
  const mode = store.settings.time;
  if (mode === 'day') return world.env.setHour(13);
  if (mode === 'night') return world.env.setHour(22);
  const now = new Date();
  world.env.setHour(now.getHours() + now.getMinutes() / 60);
}
applyTime();
setInterval(applyTime, 60_000);

// ---- grown-ups' panel and settings ---------------------------------------------
const panel = new ParentPanel(store, {
  onBedtime: () => brain.bedtime(),
  micState: () => mimic.state,
  languages: () => voice.languages,
  resolveLang: (pref) => voice.resolve(pref),
  onOpen: () => (input.enabled = false),
  onClose: () => (input.enabled = true),
});
store.onChange((key, value) => {
  if (key === 'volume') audio.setVolume(value);
  else if (key === 'ambience') ambience.enabled = value;
  else if (key === 'time') applyTime();
  else if (key === 'lang') {
    // let the grown-up hear the new language straight away
    applyLanguage().then(() => {
      if (brain.mode === 'awake') brain.speak('hello');
    });
  } else if (key === 'mimic') {
    if (value && audio.unlocked) mimic.start();
    else if (!value) mimic.stop();
  } else if (key === 'quality') {
    const i = TIERS.findIndex((t) => t.name === value);
    engine.adaptive = i < 0;
    if (i >= 0) engine.setTier(i);
  }
});

let last = performance.now();
// Whenever Lumi is off screen: no sound, and the microphone is let go (so the
// device's "mic in use" indicator goes out). Both come back when she returns.
let micWasOn = false;
document.addEventListener('visibilitychange', () => {
  audio.setSuspended(document.hidden);
  last = performance.now();
  if (document.hidden) {
    micWasOn = mimic.state === 'listening' || mimic.state === 'starting';
    if (micWasOn) mimic.stop();
  } else {
    if (micWasOn && store.settings.mimic && audio.unlocked) mimic.start();
    micWasOn = false;
    if (brain.mode === 'awake') setScreenAwake(true); // the lock is dropped whenever the page is hidden
  }
});

// ---- debug / test hooks (URL parameters) -----------------------------------------
const views = {
  front: [[0, 0.1, 1], 4.6, 0.68], 34: [[0.7, 0.2, 1], 4.6, 0.68], side: [[1, 0.1, 0], 4.6, 0.68],
  back: [[0.35, 0.2, -1], 4.6, 0.68], face: [[0, 0.04, 1], 2.3, 0.77], face34: [[0.6, 0.1, 1], 2.3, 0.77],
  icon: [[0.12, 0.06, 1], 2.75, 0.84],
  iconwide: [[0.12, 0.06, 1], 4.0, 0.8], // for Android adaptive icons, which crop to the middle
};
if (views[params.get('view')]) {
  const [dir, dist, y] = views[params.get('view')];
  engine.rig.fixedView = { dir: new THREE.Vector3(...dir).normalize(), dist, target: new THREE.Vector3(0, y, 0) };
}
const debugging = params.has('clip') || params.has('stance') || params.has('expr') || params.has('play') || params.has('awake');
if (debugging) {
  // skip the sleepy start so poses can be inspected directly
  brain.mode = 'awake';
  animator.eyesShut = false;
  animator.energy = 1;
  animator.breathRate = 1;
  animator.lookAmount = 1;
  animator.setStance('stand');
  animator.setBaseExpression('neutral');
  for (const [name, s] of Object.entries(animator.stances)) s.weight = name === 'stand' ? 1 : 0;
  brain.sitting = false;
  if (!params.has('awake')) brain.update = () => {};
}
if (params.has('clip')) animator.debugPose(params.get('clip'), Number(params.get('t') || 0));
if (params.has('stance')) animator.setStance(params.get('stance'));
if (params.has('expr')) animator.setBaseExpression(params.get('expr'));
if (params.has('play')) setTimeout(() => animator.play(params.get('play')), 600);
if (params.get('dof') === '0') engine.post.dofEnabled = false;
if (params.get('hide') === 'lumi') lumi.group.visible = false;
window.__lumi = { lumi, world, engine, scene, animator, brain, audio, vocal, sfx, voice, mimic, emotes, snack, bubbles, butterfly, blooms, input, store, panel };
/** Screen position (CSS pixels) of a named anchor on Lumi or of a world point: used by automated tests. */
window.__lumi.screenOf = (what) => {
  const p = typeof what === 'string' ? lumi.anchorWorld(what) : new THREE.Vector3(...what);
  p.project(engine.camera);
  const r = canvas.getBoundingClientRect();
  return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
};

// ---- main loop ----------------------------------------------------------------------
let time = 0;
const nose = new THREE.Vector3();
const mouth = new THREE.Vector3();

// Keep the screen awake while Lumi is up and playing; let it sleep when she naps.
let wakeLock = null;
async function setScreenAwake(on) {
  // inside the Android app, the native wrapper keeps the screen on for us
  if (window.LumiNative?.keepScreenOn) {
    window.LumiNative.keepScreenOn(on);
    return;
  }
  try {
    if (on && !wakeLock && navigator.wakeLock && !document.hidden) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null; // not supported or not allowed: the screen simply follows the device setting
  }
}
let wasAwake = false;
let frame = 0;

function tick(now) {
  requestAnimationFrame(tick);
  // while she sleeps undisturbed, draw every other frame to go easy on the battery
  const resting = brain.mode === 'asleep' && now - input.lastActivity > 4000;
  frame++;
  if (resting && frame % 2) return;
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (dt <= 0) return;
  time += dt;
  if (!resting) engine.trackPerformance(dt);
  const awake = brain.mode === 'awake';
  if (awake !== wasAwake) {
    wasAwake = awake;
    setScreenAwake(awake);
  }

  brain.update(dt);

  lumi.anchorWorld('nose', nose);
  lumi.anchorWorld('mouth', mouth);
  snack.update(dt, time, mouth);
  bubbles.halfWidth = Math.max(0.3, Math.tan((engine.camera.fov * Math.PI) / 360) * engine.camera.aspect * (engine.camera.position.z - 0.75) - 0.14);
  bubbles.update(dt, time);
  butterfly.update(dt, time, nose, brain.mode === 'awake' && !brain.script && !animator.busy && brain.petting <= 0);
  blooms.update(dt);

  const shape = audio.voiceShape();
  animator.speech.level = shape.level;
  animator.speech.wide = shape.wide;

  engine.rig.update(dt, time);
  animator.cameraPos.copy(engine.camera.position);
  animator.update(dt);
  emotes.update(dt);

  world.update(time, engine.height, dt);
  world.env.uniforms.uLumiPos.value.copy(lumi.bones.root.position);
  ambience.update(dt, world.env.state.night);

  const grade = engine.post.grade;
  grade.uSaturation.value = world.env.state.saturation;
  grade.uExposure.value = world.env.state.exposure;
  engine.render(scene, time);
}
requestAnimationFrame(tick);
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    const veil = document.getElementById('veil');
    veil?.classList.add('gone');
    setTimeout(() => veil?.remove(), 1200); // once faded, leave nothing on the page but Lumi
    window.__lumiReady = true;
  }),
);

// ---- offline support -------------------------------------------------------------------
// (not needed inside the Android app, which carries every file with it)
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && !window.LumiNative && (!local || params.has('sw'))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
