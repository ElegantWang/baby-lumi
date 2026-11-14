// Lumi's mind: decides what she does and says. It reacts to touch and voice,
// keeps simple needs (hunger, sleepiness, wanting company), and every so often
// invites the child to a tiny game. There are no menus: everything starts
// from touching Lumi, touching her world, talking to her, or her own ideas.
//
// Behaviours are written as generator "scripts": `yield 1.5` waits 1.5 s,
// `yield { until: () => done, timeout: 8 }` waits for something to happen.
import * as THREE from 'three';
import { TUNE_TWINKLE, TUNE_HAPPY, TUNE_LULLABY } from '../audio/vocal.js';
import { FOODS } from '../props/food.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;

/** How Lumi names a part of her body (when the wrong one is touched in the finding game). */
const PART_LINE = {
  nose: 'name_nose', earL: 'name_ears', earR: 'name_ears', belly: 'name_tummy', footL: 'name_feet', footR: 'name_feet',
  tail: 'name_tail', armL: 'name_hands', armR: 'name_hands', head: 'name_head', cheekL: 'name_cheeks', cheekR: 'name_cheeks',
};

/** The "can you find my ...?" game. */
export const FIND_TARGETS = [
  { ask: 'find_nose', parts: ['nose'], hint: 'boop' },
  { ask: 'find_ears', parts: ['earL', 'earR'], hint: 'earWiggle' },
  { ask: 'find_tummy', parts: ['belly'], hint: 'bellyRub' },
  { ask: 'find_feet', parts: ['footL', 'footR'], hint: 'hop' },
  { ask: 'find_tail', parts: ['tail'], hint: 'wiggle' },
  { ask: 'find_hands', parts: ['armL', 'armR'], hint: 'clap' },
  { ask: 'find_head', parts: ['head', 'star', 'eyeL', 'eyeR'], hint: 'nod' },
];

const ANIMALS = ['cow', 'duck', 'cat', 'dog', 'sheep'];
export const INVITATIONS = ['find', 'bubbles', 'peekaboo', 'count', 'animal', 'dance', 'sing', 'love', 'find', 'butterfly'];

const HUNGER_TIME = 300; // seconds from full to hungry
const NAP_AFTER = 150; // seconds of being left alone before a daytime nap
const BED_AFTER = 70; // ... before going back to sleep at night

export class Brain {
  /**
   * @param {object} d  lumi, anim, rig, env, audio, vocal, sfx, voice, emotes,
   *                    snack, bubbles, butterfly, blooms, mimic, store, input
   */
  constructor(d) {
    Object.assign(this, d);
    this.clock = d.clock || (() => new Date());
    this.mode = 'asleep';
    this.script = null;
    this.t = 0;
    this.sinceTouch = 0;
    this.idleTimer = 3;
    this.inviteTimer = 22;
    this.inviteBag = [];
    this.hunger = 0.35;
    this.snacksInARow = 0;
    this.petting = 0;
    this.petBeat = 0;
    this.wasPetting = false;
    this.listening = false;
    this.listenTimeout = 0;
    this.nosePokes = [];
    this.spins = [];
    this.sitting = false;
    this.popped = 0;
    this.bloomCount = 0;
    this.zzzTimer = 1;
    this.snoreTimer = 3;
    this.hintTimer = 1.5;
    this.lastCall = -100;
    this.streaks = []; // shooting stars in flight
    this.night = false;
    this._v = new THREE.Vector3();

    this.anim.onEvent = (name, args) => this.#clipEvent(name, args);
    this.bubbles.onPop = (b) => this.#bubblePopped(b);
    this.butterfly.onLanded = () => this.#butterflyLanded();
    if (this.mimic) {
      this.mimic.onSpeechStart = () => this.#heard('start');
      this.mimic.onSpeechCancel = () => this.#heard('cancel');
      this.mimic.onUtterance = (buffer, seconds) => this.#heard('utterance', buffer, seconds);
    }
    if (this.input) this.#bindInput(this.input);
    this.#enterSleep(true);
  }

  // =====================================================================
  // script runner
  // =====================================================================

  /**
   * Start a behaviour script, replacing the current one.
   * @param {string} name
   * @param {Generator} gen
   * @param {{lock?: boolean, cleanup?: () => void}} opts lock = touches on Lumi do not interrupt it
   */
  run(name, gen, opts = {}) {
    this.#endScript();
    this.script = { name, gen, wait: 0, until: null, timeout: 0, lock: !!opts.lock, cleanup: opts.cleanup || null, onTap: null };
  }

  #endScript() {
    const s = this.script;
    if (!s) return;
    this.script = null;
    try {
      s.gen.return?.();
    } catch {
      /* generator already finished */
    }
    s.cleanup?.();
    this.idleTimer = rnd(2.5, 5);
  }

  #step(dt) {
    const s = this.script;
    if (!s) return;
    if (s.until) {
      s.timeout -= dt;
      if (!s.until() && s.timeout > 0) return;
      s.until = null;
    } else if (s.wait > 0) {
      s.wait -= dt;
      if (s.wait > 0) return;
    }
    let r;
    try {
      r = s.gen.next();
    } catch (e) {
      console.error('[lumi] script', s.name, 'failed:', e);
      if (this.script === s) this.#endScript();
      return;
    }
    if (this.script !== s) return; // the script replaced itself
    if (r.done) return this.#endScript();
    if (typeof r.value === 'number') s.wait = r.value;
    else if (r.value && typeof r.value.until === 'function') {
      s.until = r.value.until;
      s.timeout = r.value.timeout ?? 10;
    }
  }

  get busy() {
    return !!this.script;
  }

  // =====================================================================
  // small helpers
  // =====================================================================

  /** Say a line; returns how long it lasts (0 if she cannot speak right now). */
  speak(group, { gesture = true } = {}) {
    const r = this.voice.say(group, { gain: this.night ? 0.82 : 1 });
    if (!r) return 0;
    if (gesture && chance(0.55) && !this.anim.busy) this.anim.play(pick(['talkGesture1', 'talkGesture2', 'talkGesture3']), { layer: true });
    return r.duration;
  }

  emote(kind, where, count = 1, opts = {}) {
    const p = typeof where === 'string' ? this.lumi.anchorWorld(where, this._v) : where;
    this.emotes.burst(kind, p, count, opts);
  }

  #clipEvent(name, args) {
    if (name === 'sfx') {
      const s = args[0];
      if (s === 'jump') {
        this.sfx.play('jump');
        this.vocal.hup(0.02);
      } else if (['yawn', 'achoo', 'chomp', 'munch', 'gulp', 'kiss', 'raspberry'].includes(s)) this.vocal[s]();
      else this.sfx.play(s);
    } else if (name === 'emote') {
      this.emote(args[0], 'headTop', args[1] || 1);
      if (args[0] === 'heart') this.sfx.play('heart');
      if (args[0] === 'star') this.sfx.play('sparkle');
    } else if (name === 'puff') {
      this._v.copy(this.lumi.bones.root.position).setY(0.05);
      this.emotes.burst('puff', this._v, 6, { spread: 0.3, size: 0.09, stagger: 0 });
    } else if (name === 'bite') {
      this.snack.bite();
      this.emote('sparkle', 'mouth', 4, { size: 0.03 });
    }
  }

  #touched() {
    this.sinceTouch = 0;
  }

  // =====================================================================
  // sleeping and waking
  // =====================================================================

  #enterSleep(snap = false) {
    const A = this.anim;
    this.mode = 'asleep';
    this.sitting = true;
    A.setStance('asleep');
    A.setBaseExpression('asleep');
    A.eyesShut = true;
    A.energy = 0.2;
    A.breathRate = 0.55;
    A.wag = 0;
    A.lookAmount = 0;
    this.listening = false;
    this.zzzTimer = 1.2;
    this.snoreTimer = 2.5;
    if (snap) {
      for (const s of Object.values(A.stances)) s.weight = 0;
      A.stances.asleep.weight = 1;
      A.exprNow.lidUpperL = A.exprNow.lidUpperR = 1;
    }
    if (this.mimic) this.mimic.paused = true;
  }

  /** Wake Lumi up (first touch of a visit, or after a nap). */
  wake() {
    if (this.mode !== 'asleep') return;
    this.mode = 'awake';
    this.#touched();
    this.run('wake', this.#wakeSeq(), { lock: true });
  }

  *#wakeSeq() {
    const A = this.anim, data = this.store.data;
    A.eyesShut = false;
    A.setBaseExpression('neutral');
    A.energy = 1;
    A.breathRate = 1;
    A.wag = 0.55;
    A.lookAmount = 1;
    A.play('wake');
    this.sfx.play('magic');
    yield 1.0;
    A.setStance('stand');
    this.sitting = false;
    yield 2.3;
    this.script.lock = false; // from here on a touch may cut the greeting short
    const first = !data.firstRunDone;
    const hour = this.clock().getHours();
    const group = first ? 'intro' : hour >= 5 && hour < 11 && chance(0.6) ? pick(['wake', 'morning']) : 'hello';
    A.play('wave');
    const d = this.speak(group, { gesture: false });
    data.firstRunDone = true;
    data.visits = (data.visits || 0) + 1;
    data.lastSeen = Date.now();
    this.store.save();
    if (this.mimic) this.mimic.paused = false;
    yield Math.max(d, 1.8) + 0.5;
    this.inviteTimer = first ? 3 : rnd(14, 24);
    if (first) this.inviteBag = ['find'];
  }

  /** Tuck Lumi in: yawn, say good night, sit down, fall asleep. */
  bedtime() {
    if (this.mode === 'asleep') return;
    this.run('bedtime', this.#sleepSeq(true), { lock: true });
  }

  *#sleepSeq(say) {
    const A = this.anim;
    if (this.mimic) this.mimic.paused = true;
    this.snack.dismiss();
    this.bubbles.clear();
    this.butterfly.shoo();
    A.setBaseExpression('sleepy');
    A.play('yawn');
    yield 3.3;
    if (say) {
      const d = this.speak(this.night ? 'night' : 'sleepy', { gesture: false });
      yield d + 0.4;
    }
    A.setStance('sit');
    this.sitting = true;
    A.play('plop', { layer: true });
    yield 1.0;
    if (this.night) {
      const dur = this.vocal.sing(TUNE_LULLABY.slice(0, 7), 76);
      this.emote('note', 'headTop', 2, { stagger: 1.4 });
      yield dur + 0.3;
    }
    this.#enterSleep();
  }

  // =====================================================================
  // touch
  // =====================================================================

  #bindInput(input) {
    input.on('down', () => {
      // any touch opens the audio (browsers require a gesture) and the microphone
      if (!this.audio.unlocked) {
        this.audio.unlock().then((ok) => {
          if (ok) this.onAudioReady?.();
        });
      } else if (this.audio.ctx?.state !== 'running') this.audio.unlock();
    });
    input.on('tap', (e) => this.onTap(e.hit));
    input.on('hold', (e) => this.onHold(e.hit));
    input.on('hug', () => this.onHold({ kind: 'lumi', part: 'belly' }));
    input.on('swipe', (e) => this.onSwipe(e.dir, e.start));
    input.on('stroke', (e) => this.onStroke(e));
    input.on('dragstart', (e) => this.onDragStart(e));
    input.on('drag', (e) => this.onDrag(e));
    input.on('dragend', (e) => this.onDragEnd(e));
  }

  onTap(hit) {
    this.#touched();
    if (this.mode === 'asleep') return this.wake();
    if (this.script?.onTap && this.script.onTap(hit)) return;
    if (hit.kind === 'prop') return this.#tapProp(hit);
    if (this.script?.lock) return;
    if (hit.kind === 'lumi') return this.#react(hit.part);
    if (hit.kind === 'ground') return this.#tapGround(hit.point);
    if (hit.kind === 'sky') return this.#tapSky(hit.point);
  }

  #react(part) {
    const A = this.anim;
    const side = part.endsWith('L') ? 'L' : 'R';
    this.sfx.play('tap');
    switch (part) {
      case 'nose':
        return this.run('nose', this.#noseSeq());
      case 'eyeL':
      case 'eyeR':
        return this.run('peekaboo', this.#peekabooSeq(), { lock: true });
      case 'star':
        return this.run('star', this.#starSeq());
      case 'head':
        return this.run('head', this.#simpleSeq({ clip: chance(0.5) ? 'nod' : 'earWiggle', poke: true, expr: 'happy', vocal: 'coo', voice: 'head', voiceChance: 0.4, emote: 'heart' }));
      case 'cheekL':
      case 'cheekR':
        return this.run('cheek', this.#simpleSeq({ clip: 'giggle', vocal: 'giggle', voice: 'cheeks', voiceChance: 0.4, voiceDelay: 1.1 }));
      case 'earL':
      case 'earR':
        return this.run('ear', this.#simpleSeq({ clip: 'earFlick' + side, vocal: 'oh', voice: 'ears', voiceChance: 0.5, voiceDelay: 0.5 }));
      case 'belly':
        if (this.hunger > 0.8) this.sfx.play('rumble');
        return this.run('tickle', this.#simpleSeq({ clip: 'tickle', vocal: 'laugh', voice: 'tickle', voiceChance: 0.55, voiceDelay: 1.5 }));
      case 'armL':
      case 'armR':
        return this.run('hand', this.#simpleSeq({ clip: 'highFive' + side, vocal: 'yay', voice: 'hands', voiceChance: 0.55, voiceDelay: 0.75 }));
      case 'footL':
      case 'footR':
        return this.run('foot', this.#simpleSeq({ clip: 'footTickle' + side, vocal: 'giggle', voice: 'feet', voiceChance: 0.5, voiceDelay: 1.0 }));
      case 'tail':
        return this.run('tail', this.#simpleSeq({ clip: 'tailSurprise', vocal: 'huh', voice: 'tail', voiceChance: 0.7, voiceDelay: 0.9 }));
      default:
        A.play('poke', { layer: true });
    }
  }

  *#simpleSeq(o) {
    const A = this.anim;
    if (o.poke) A.play('poke', { layer: true });
    if (o.expr) A.setExpression(o.expr, 1.6);
    const dur = A.clips[o.clip].dur;
    A.play(o.clip);
    if (o.vocal) this.vocal[o.vocal](0.04);
    if (o.emote) this.emote(o.emote, 'headTop', 1);
    if (o.voice && chance(o.voiceChance ?? 0.5)) {
      const delay = o.voiceDelay ?? 0.8;
      yield delay;
      const d = this.speak(o.voice, { gesture: false });
      yield Math.max(d + 0.25, dur - delay);
    } else {
      yield dur;
    }
  }

  *#noseSeq() {
    const now = this.t;
    this.nosePokes = this.nosePokes.filter((t) => now - t < 7);
    this.nosePokes.push(now);
    if (this.nosePokes.length >= 3) {
      this.nosePokes.length = 0;
      yield* this.#sneezeSeq();
      return;
    }
    this.sfx.play('pop');
    this.anim.play('boop');
    if (chance(0.5)) {
      this.vocal.oh(0.03);
      yield 1.7;
    } else {
      yield 0.25;
      const d = this.speak('nose', { gesture: false });
      yield Math.max(d + 0.2, 1.5);
    }
  }

  *#sneezeSeq() {
    this.anim.play('sneeze');
    this.vocal.ahAh(0.3);
    yield 2.5;
    const d = this.speak('excuse', { gesture: false });
    yield d + 0.3;
  }

  *#starSeq() {
    const A = this.anim;
    A.setExpression('wow', 2.2);
    A.play('poke', { layer: true });
    this.sfx.play('magic');
    this.emote('sparkle', 'star', 9, { spread: 0.25, size: 0.045 });
    this.emote('star', 'star', 4);
    this.starGlow = 1;
    yield 0.7;
    const d = this.speak('wow', { gesture: false });
    yield Math.max(d, 0.9) + 0.3;
  }

  *#peekabooSeq() {
    this.anim.play('peekaboo');
    this.speak('peek', { gesture: false });
    yield 1.95;
    this.speak('boo', { gesture: false });
    yield 1.25;
    this.vocal.giggle();
    yield 0.9;
  }

  onHold(hit) {
    this.#touched();
    if (this.mode === 'asleep') return this.wake();
    if (hit.kind !== 'lumi' || this.script?.lock) return;
    this.run('hug', this.#hugSeq(), { lock: true, cleanup: () => (this.rig.zoomGoal = 1) });
  }

  *#hugSeq() {
    this.anim.play('hug');
    this.rig.zoomGoal = 0.86;
    this.vocal.coo(0.1);
    yield 1.0;
    const d = this.speak('love', { gesture: false });
    yield Math.max(1.4, d + 0.3);
    this.rig.zoomGoal = 1;
    yield 0.7;
  }

  onSwipe(dir, start) {
    this.#touched();
    if (this.mode === 'asleep') return this.wake();
    if (this.script?.lock) return;
    const A = this.anim;
    if (start.kind !== 'lumi') {
      // a swipe across the sky or grass is a puff of wind
      if (dir === 'left' || dir === 'right') {
        this.env.gust = 1;
        this.sfx.play('whoosh');
        A.play('shiver', { layer: true });
      }
      return;
    }
    if (dir === 'up') {
      this.run('jump', (function* (self) {
        if (self.sitting) {
          A.setStance('stand');
          self.sitting = false;
        }
        A.play('jump');
        if (chance(0.6)) self.vocal.whee(0.25);
        yield 1.3;
        if (chance(0.3)) {
          const d = self.speak('jump', { gesture: false });
          yield d + 0.2;
        }
      })(this));
    } else if (dir === 'down') {
      this.sitting = !this.sitting;
      A.setStance(this.sitting ? 'sit' : 'stand');
      A.play(this.sitting ? 'plop' : 'poke', { layer: true });
      if (!this.sitting) A.play('hop');
    } else {
      this.run('spin', this.#spinSeq());
    }
  }

  *#spinSeq() {
    const A = this.anim, now = this.t;
    if (this.sitting) {
      A.setStance('stand');
      this.sitting = false;
    }
    this.spins = this.spins.filter((t) => now - t < 10);
    this.spins.push(now);
    A.play('spin');
    this.vocal.whee(0.2);
    yield 1.45;
    if (this.spins.length >= 3) {
      this.spins.length = 0;
      A.play('dizzy');
      const d = this.speak('dizzy', { gesture: false });
      yield Math.max(d, 2.9) + 0.2;
    } else if (chance(0.4)) {
      const d = this.speak('spin', { gesture: false });
      yield d + 0.2;
    }
  }

  // ---- stroking -----------------------------------------------------------

  onStroke(e) {
    if (this.mode === 'asleep' || e.start.kind === 'prop') return;
    this.#touched();
    if (this.script?.lock) return;
    if (e.part === 'belly' && e.speed > 0.9 && this.script?.name !== 'tickle') {
      return this.#react('belly');
    }
    if (this.script && this.petting <= 0) this.#endScript();
    if (this.petting <= 0) {
      this.petBeat = 0.25;
      this.anim.stopAll();
    }
    this.petting = 0.75;
    this.petPart = e.part;
  }

  #updatePetting(dt) {
    const A = this.anim;
    if (this.petting > 0) {
      this.petting -= dt;
      this.wasPetting = true;
      A.setStance('petted');
      A.setExpression('bliss', 0.4);
      A.wag = 1;
      this.petBeat -= dt;
      if (this.petBeat <= 0) {
        this.petBeat = rnd(1.0, 1.5);
        this.emote('heart', 'headTop', 1);
        this.sfx.play('heart');
        if (chance(0.6)) this.vocal.coo();
      }
    } else if (this.wasPetting) {
      this.wasPetting = false;
      A.setStance(this.sitting ? 'sit' : 'stand');
      A.wag = 0.6;
      if (chance(0.45)) this.speak('pet');
      this.idleTimer = rnd(3, 5);
    }
  }

  // ---- props ---------------------------------------------------------------

  #tapProp(hit) {
    const prop = hit.prop;
    if (prop === this.snack) return this.#feed();
    if (prop.type === 'bubble') return this.bubbles.pop(prop.bubble);
    if (prop.type === 'butterfly') {
      this.emote('sparkle', this.butterfly.pos, 5, { size: 0.03 });
      this.sfx.play('flutter');
      this.butterfly.shoo();
      if (!this.script?.lock && chance(0.5)) this.speak('butterfly');
    }
  }

  onDragStart(e) {
    if (e.start.kind === 'prop' && e.start.prop === this.snack && this.snack.state === 'waiting') {
      this.snack.state = 'dragged';
      this.dragId = e.id;
    }
  }

  onDrag(e) {
    if (this.snack.state === 'dragged' && e.id === this.dragId) {
      this.#touched();
      this.input.pointOnPlane(e.x, e.y, this.snack.pos, this.snack.pos);
      this.snack.pos.y = Math.max(0.08, this.snack.pos.y);
    }
  }

  onDragEnd(e) {
    if (this.snack.state === 'dragged' && e.id === this.dragId) {
      const mouth = this.lumi.anchorWorld('mouth', this._v);
      if (this.snack.pos.distanceTo(mouth) < 0.45) this.#feed();
      else this.snack.state = 'waiting';
    }
  }

  #feed() {
    if (this.snack.state !== 'waiting' && this.snack.state !== 'dragged') return;
    this.#touched();
    this.snack.flyTo(this.lumi.anchorWorld('mouth', this._v));
    this.run('eat', this.#eatSeq(), { lock: true });
  }

  *#eatSeq() {
    const A = this.anim;
    A.mouthBias = 0;
    A.play('eat');
    yield 3.0;
    this.hunger = 0;
    this.snacksInARow++;
    const d = this.speak('yum', { gesture: false });
    yield Math.max(d, 1.1) + 0.3;
  }

  *#hungrySeq() {
    const A = this.anim;
    this.sfx.play('rumble');
    A.play('bellyRub');
    yield 1.3;
    let d = this.speak('hungry');
    yield d + 0.3;
    const kind = pick(FOODS);
    this.snack.spawn(kind);
    this.sfx.play('pop');
    this.emote('sparkle', this.snack.home, 5, { size: 0.035 });
    A.setExpression('wow', 2);
    yield 0.5;
    d = this.speak(kind, { gesture: false });
    yield d + 0.2;
    // now it is up to the child: tap the snack, or drag it to her mouth
    let waited = 0, reminded = false;
    while (this.snack.state === 'waiting' || this.snack.state === 'dragged') {
      A.lookAt(this.snack.pos, 0.5);
      yield 0.25;
      waited += 0.25;
      if (waited > 9 && !reminded) {
        reminded = true;
        this.speak('snack_please');
      }
      if (waited > 28) {
        this.snack.dismiss();
        this.hunger = 0.6;
        return;
      }
    }
  }

  #tapGround(p) {
    const top = this.blooms.grow(p.x, p.z);
    this.sfx.play('bloom');
    this._v.set(top.x, top.y, top.z);
    this.emote('sparkle', this._v, 4, { size: 0.03 });
    this.anim.lookAt(this._v, 1.6);
    this.bloomCount++;
    if (this.script) return;
    this.anim.setExpression('wow', 1.4);
    if (this.bloomCount % 4 === 0 && !this.butterfly.active && !this.night) {
      this.butterfly.spawn(this._v);
      this.speak('butterfly');
    } else if (chance(0.35)) this.speak('flower');
  }

  #tapSky(p) {
    if (this.night) return this.#shootingStar(p);
    // bubbles! they drift up from around the touch, low enough to stay in reach for a while
    const n = this.bubbles.count > 0 ? 3 : 5;
    this.emotes.burst('sparkle', p, 5, { size: 0.03, stagger: 0 });
    for (let i = 0; i < n; i++) {
      this._v.set(p.x + rnd(-0.45, 0.45), Math.min(1.05, Math.max(0.3, p.y - rnd(0.2, 0.9))), p.z + rnd(-0.05, 0.1));
      this.bubbles.spawn(this._v, { delay: i * 0.14 });
    }
    this.sfx.play('bubble');
    if (!this.script) this.run('bubbles', this.#bubblesSeq(false));
  }

  *#bubblesSeq(blowThem) {
    const A = this.anim;
    this.popped = 0;
    if (blowThem) {
      const d = this.speak('bubbles');
      yield d * 0.7;
      const mouth = this.lumi.anchorWorld('mouth').add(new THREE.Vector3(0, 0, 0.12));
      for (let i = 0; i < 6; i++) {
        this.bubbles.spawn(mouth, { delay: i * 0.2 });
        this.sfx.play('bubble');
        A.speech.level = 0.5;
        yield 0.2;
      }
    }
    A.setExpression('wow', 2.5);
    let t = 0;
    while (this.bubbles.count > 0 && t < 20) {
      // watch the nearest bubble float by
      let best = null, bd = 1e9;
      for (const b of this.bubbles.items) {
        const dd = b.pos.distanceToSquared(this.lumi.bones.head.getWorldPosition(this._v));
        if (dd < bd) {
          bd = dd;
          best = b;
        }
      }
      if (best) A.lookAt(best.pos, 0.5);
      yield 0.25;
      t += 0.25;
    }
    if (this.popped >= 3) {
      A.play('clap');
      this.vocal.yay(0.1);
      yield 1.0;
      const d = this.speak('yay', { gesture: false });
      yield Math.max(d, 0.8) + 0.3;
    }
  }

  #bubblePopped(b) {
    this.#touched();
    this.popped++;
    this.sfx.play('pop');
    this.emotes.burst('ring', b.pos, 1, { size: b.radius * 1.1, color: b.color.rgb, stagger: 0 });
    this.emotes.burst('sparkle', b.pos, 6, { size: 0.03, color: b.color.rgb, spread: 0.1, stagger: 0 });
    if (this.mode === 'awake') {
      this.speak(b.color.name, { gesture: false });
      this.anim.play('poke', { layer: true });
    }
  }

  #butterflyLanded() {
    if (this.mode !== 'awake' || this.script) return;
    this.run('butterflyNose', (function* (self) {
      const A = self.anim;
      A.play('boop');
      self.vocal.oh(0.05);
      yield 1.9;
      if (chance(0.45)) {
        yield* self.#sneezeSeq();
        self.butterfly.shoo();
      } else {
        A.play('giggle');
        self.vocal.giggle();
        yield 1.2;
        const d = self.speak('butterfly', { gesture: false });
        yield d + 0.3;
      }
    })(this));
  }

  #shootingStar(p) {
    const from = new THREE.Vector3(p.x + (p.x > 0 ? 0.9 : -0.9), p.y + 0.7, p.z - 0.4);
    this.streaks.push({ from, to: p.clone(), t: 0, dur: 0.6, trail: 0 });
    this.sfx.play('zip');
    if (!this.script && this.mode === 'awake') {
      this.anim.lookAt(p, 1.5);
      this.anim.setExpression('wow', 1.8);
      if (chance(0.6)) this.speak('star');
    }
  }

  #updateStreaks(dt) {
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i];
      s.t += dt;
      const u = Math.min(1, s.t / s.dur);
      this._v.lerpVectors(s.from, s.to, u);
      s.trail -= dt;
      if (s.trail <= 0) {
        s.trail = 0.03;
        this.emotes.burst('sparkle', this._v, 1, { size: 0.035, spread: 0.03, speed: 0.2, stagger: 0 });
      }
      if (u >= 1) {
        this.emotes.burst('star', s.to, 6, { size: 0.05 });
        this.sfx.play('star');
        this.streaks.splice(i, 1);
      }
    }
  }

  // =====================================================================
  // voice: repeat what the child says
  // =====================================================================

  #heard(what, buffer, seconds) {
    if (this.mode !== 'awake' || !this.store.settings.mimic) return;
    const A = this.anim;
    if (what === 'start') {
      if (this.script?.lock) return;
      this.#touched();
      this.listening = true;
      this.listenTimeout = 9;
      A.setStance('listen');
      A.setExpression('listening', 9);
      A.lookAt(null, 0);
    } else if (what === 'cancel') {
      this.#stopListening();
    } else if (what === 'utterance') {
      if (!this.listening) return;
      this.#stopListening();
      this.#touched();
      // while a question is pending (animal sounds), any answer earns the reply
      if (this.script?.onHeard) return this.script.onHeard();
      this.run('mimic', this.#mimicSeq(buffer, seconds));
    }
  }

  #stopListening() {
    if (!this.listening) return;
    this.listening = false;
    this.anim.setStance(this.sitting ? 'sit' : 'stand');
    this.anim.setExpression(this.anim.baseExpression, 0.01);
  }

  *#mimicSeq(buffer, seconds) {
    const A = this.anim;
    yield 0.22;
    // the classic: say it back, higher and faster
    const rate = 1.38;
    this.audio.playBuffer(buffer, { bus: 'voice', rate, gain: 0.9 });
    A.setExpression('happy', seconds / rate + 0.4);
    A.play(pick(['talkGesture1', 'talkGesture2', 'talkGesture3']), { layer: true });
    yield seconds / rate + 0.25;
    const r = Math.random();
    if (r < 0.3) {
      A.play('giggle');
      this.vocal.giggle();
      yield 1.3;
    } else if (r < 0.5) {
      A.play('nod');
      yield 0.9;
    } else if (r < 0.62) {
      A.play('clap');
      yield 1.6;
    }
  }

  // =====================================================================
  // Lumi's own ideas
  // =====================================================================

  #idle() {
    const A = this.anim;
    const alone = this.sinceTouch;
    if (alone > (this.night ? BED_AFTER : NAP_AFTER)) return this.run('bedtime', this.#sleepSeq(this.night), { lock: true });
    if (this.hunger >= 1 && !this.snack.active && this.snacksInARow < 3 && alone < 60) {
      return this.run('hungry', this.#hungrySeq());
    }
    if (alone > 28 && this.t - this.lastCall > 34) {
      this.lastCall = this.t;
      return this.run('call', (function* (self) {
        self.anim.play('wave');
        const d = self.speak('bored', { gesture: false });
        yield Math.max(d, 2.2);
      })(this));
    }
    if (this.inviteTimer <= 0 && alone < 40 && !this.night) {
      this.inviteTimer = rnd(26, 44);
      return this.#invite();
    }
    if (this.sitting && chance(0.35)) {
      this.sitting = false;
      A.setStance('stand');
      A.play('hop');
      return;
    }
    // a little idle business
    const sleepy = this.night || this.sinceTouch > 90;
    const options = [
      ['lookAround', 3], ['sniff', 2], ['stretch', 1.5], ['scratchEar', 1.5], ['earWiggle', 2], ['hop', 1], ['wiggle', 1],
      ['think', 1], ['babble', 2.5], ['sit', 0.8], ['yawn', sleepy ? 4 : 0.3], ['butterfly', this.night || this.butterfly.active ? 0 : 0.7],
      ['raspberry', 0.5], ['bow', 0.3],
    ];
    const total = options.reduce((s, o) => s + o[1], 0);
    let r = Math.random() * total, choice = options[0][0];
    for (const [name, w] of options) {
      r -= w;
      if (r <= 0) {
        choice = name;
        break;
      }
    }
    if (choice === 'babble') {
      this.vocal.babble(3 + Math.floor(Math.random() * 4));
      A.play(pick(['talkGesture1', 'talkGesture2', 'talkGesture3']));
    } else if (choice === 'sit') {
      this.sitting = true;
      A.setStance('sit');
      A.play('plop', { layer: true });
    } else if (choice === 'butterfly') {
      this.butterfly.spawn();
    } else {
      A.play(choice);
    }
  }

  #invite() {
    if (!this.inviteBag.length) this.inviteBag = INVITATIONS.slice().sort(() => Math.random() - 0.5);
    this.startActivity(this.inviteBag.pop());
  }

  /** Start one of Lumi's little games by name (also used by tests). */
  startActivity(kind) {
    const A = this.anim;
    if (this.sitting && kind !== 'sing') {
      this.sitting = false;
      A.setStance('stand');
    }
    switch (kind) {
      case 'find':
        return this.run('find', this.#findSeq(pick(FIND_TARGETS)));
      case 'bubbles':
        return this.run('bubbles', this.#bubblesSeq(true));
      case 'peekaboo':
        return this.run('peekaboo', this.#peekabooSeq(), { lock: true });
      case 'count':
        return this.run('count', this.#countSeq(chance(0.25) ? 10 : pick([3, 5])), { lock: true });
      case 'animal':
        return this.run('animal', this.#animalSeq(pick(ANIMALS)));
      case 'dance':
        return this.run('dance', this.#danceSeq(), { cleanup: () => this.anim.stopAll() });
      case 'sing':
        return this.run('sing', this.#singSeq(), { cleanup: () => this.anim.stopAll() });
      case 'love':
        return this.run('love', (function* (self) {
          self.anim.play('kiss');
          yield 1.1;
          const d = self.speak(pick(['love', 'kind']), { gesture: false });
          yield d + 0.6;
        })(this));
      case 'butterfly':
        if (!this.butterfly.active) this.butterfly.spawn();
        return this.speak('butterfly');
      case 'hungry':
        return this.run('hungry', this.#hungrySeq());
      default:
        throw new Error(`unknown activity "${kind}"`);
    }
  }

  *#findSeq(target) {
    const A = this.anim;
    let found = null, wrong = null, misses = 0, waits = 0;
    this.script.onTap = (hit) => {
      if (hit.kind !== 'lumi') return false;
      if (target.parts.includes(hit.part)) found = hit.part;
      else wrong = hit.part;
      return true;
    };
    A.setExpression('curious', 5);
    let d = this.speak(target.ask);
    yield d + 0.1;
    while (!found) {
      yield { until: () => found || wrong, timeout: 8 };
      if (found) break;
      if (wrong) {
        // name what was touched instead, kindly, and ask again
        const line = PART_LINE[wrong];
        wrong = null;
        misses++;
        A.play('poke', { layer: true });
        this.sfx.play('tap');
        if (line) {
          d = this.speak(line, { gesture: false });
          yield d + 0.25;
        }
        if (found) break;
        if (misses >= 3) break;
        d = this.speak('retry');
        yield d + 0.2;
      } else {
        // nobody touched anything: wiggle the answer as a hint, then ask once more
        waits++;
        if (waits >= 2) break;
        A.play(target.hint);
        yield A.clips[target.hint].dur * 0.8;
        d = this.speak(target.ask);
        yield d + 0.1;
      }
    }
    this.script.onTap = null;
    if (found) {
      this.sfx.play('success');
      A.play('cheer');
      this.vocal.yay(0.05);
      yield 0.85;
      d = this.speak('found', { gesture: false });
      yield Math.max(d, 1.0) + 0.3;
    } else {
      A.play(target.hint);
      yield A.clips[target.hint].dur;
    }
  }

  *#countSeq(n) {
    const A = this.anim;
    let d = this.speak('count_intro');
    yield d + 0.35;
    for (let i = 1; i <= n; i++) {
      A.play('hop');
      this.sfx.play('count', { n: i });
      this.emote('star', 'headTop', 1, { stagger: 0 });
      d = this.speak('n' + i, { gesture: false });
      yield Math.max(0.9, d + 0.3);
    }
    yield 0.15;
    A.play('cheer');
    this.sfx.play('success');
    yield 0.6;
    d = this.speak('count_done', { gesture: false });
    yield d + 0.5;
  }

  *#animalSeq(animal) {
    const A = this.anim;
    let answered = false;
    this.script.onHeard = () => (answered = true);
    A.play('think');
    let d = this.speak(animal + '_q', { gesture: false });
    yield d + 0.2;
    // leave room for the child to answer first
    yield { until: () => answered, timeout: 2.6 };
    this.script.onHeard = null;
    A.play('point');
    d = this.speak(animal + '_a', { gesture: false });
    yield d + 0.35;
    if (answered) {
      A.play('clap');
      d = this.speak('found', { gesture: false });
      yield Math.max(d, 1.4);
    } else {
      A.play('giggle');
      this.vocal.giggle();
      yield 1.2;
    }
  }

  *#danceSeq() {
    const A = this.anim;
    const d = this.speak('dance');
    yield d + 0.25;
    A.play(pick(['dance1', 'dance2']));
    for (let round = 0; round < 2; round++) {
      const dur = this.vocal.sing(TUNE_HAPPY, 132);
      this.emote('note', 'headTop', 3, { stagger: 0.9 });
      yield dur + 0.1;
    }
    A.stopAll();
    A.play('cheer');
    yield 1.5;
  }

  *#singSeq() {
    const A = this.anim;
    const d = this.speak('sing');
    yield d + 0.3;
    A.play('sing');
    const dur = this.vocal.sing(TUNE_TWINKLE, 104);
    this.emote('note', 'headTop', 6, { stagger: 1.2 });
    yield dur + 0.2;
    A.stopAll();
    A.play('bow');
    this.sfx.play('sparkle');
    yield 1.5;
  }

  // =====================================================================
  // every frame
  // =====================================================================

  update(dt) {
    const A = this.anim;
    this.t += dt;
    this.night = this.env.state.night > 0.5;
    this.#updateStreaks(dt);

    // forehead star: glows when touched, pulses softly while she listens
    this.starGlow = Math.max(0, (this.starGlow || 0) - dt * 0.7);
    A.starBoost = Math.max(this.starGlow, this.listening ? 0.55 + 0.35 * Math.sin(this.t * 6) : 0, this.night ? 0.35 : 0);

    // snack coming close makes her open wide
    if (this.snack.state === 'dragged') {
      const dist = this.snack.pos.distanceTo(this.lumi.anchorWorld('mouth', this._v));
      A.mouthBias = Math.max(0, Math.min(1, 1.6 - dist * 2.6));
      A.lookAt(this.snack.pos, 0.3);
    } else A.mouthBias = 0;

    this.rig.followGoal.set(this.lumi.bones.root.position.x, this.lumi.bones.root.position.y, 0);

    if (this.mode === 'asleep') {
      this.zzzTimer -= dt;
      if (this.zzzTimer <= 0) {
        this.zzzTimer = 2.3;
        this.emote('zzz', this.lumi.anchorWorld('headTop', this._v).add(new THREE.Vector3(0.22, -0.05, 0.1)), 1);
      }
      this.snoreTimer -= dt;
      if (this.snoreTimer <= 0) {
        this.snoreTimer = 4.6;
        this.vocal.snore();
      }
      // before the very first touch, a soft ripple on her nose says "tap me"
      if (!this.audio.unlocked) {
        this.hintTimer -= dt;
        if (this.hintTimer <= 0) {
          this.hintTimer = 2.6;
          this.emotes.burst('ring', this.lumi.anchorWorld('nose', this._v), 1, { size: 0.05, stagger: 0 });
        }
      }
      return;
    }

    this.sinceTouch += dt;
    this.hunger = Math.min(1.2, this.hunger + dt / HUNGER_TIME);
    this.inviteTimer -= dt;
    if (this.sinceTouch > 45) this.snacksInARow = 0;
    if (this.listening) {
      this.listenTimeout -= dt;
      if (this.listenTimeout <= 0) this.#stopListening();
    }

    this.#step(dt);
    this.#updatePetting(dt);

    // keep an eye on a visiting butterfly
    if (this.butterfly.active && !this.script && this.butterfly.state !== 'leave') A.lookAt(this.butterfly.pos, 0.3);

    A.wag = this.petting > 0 ? 1 : this.script ? 0.8 : this.night ? 0.3 : 0.5;

    if (!this.script && this.petting <= 0 && !this.listening && !A.busy) {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        this.idleTimer = rnd(3.2, 6.5);
        this.#idle();
      }
    }
  }
}
