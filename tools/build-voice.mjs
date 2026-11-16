// Records Lumi's spoken lines, in every language she speaks, with a
// text-to-speech model that performs them in her voice (tools/voice/persona.mjs
// says who she is and how each group of lines is delivered). Each line is
// trimmed, evened out in loudness and written as compressed audio to
// app/assets/voice/<language>/ together with a manifest.
//
// A speech model is an actor, not a tape recorder: now and then it fluffs a
// word, squeals, or drifts out of character. So every take is checked. Two
// transcribers listen and write down what they hear, which is compared with the
// line; and the pitch is measured against Lumi's own. A take that fails is
// recorded again (more softly, if she squealed), and the best take is kept.
// Lines that never came out clean are listed at the end, for a human to listen
// to. Listeners mishear too, above all a lone "Moo!" in a tiny voice, so
// "LISTEN" means just that, not "wrong".
//
//   node tools/build-voice.mjs                  whatever is new or has changed
//   node tools/build-voice.mjs --lang zh,ja     just these languages ("sounds" = her giggles and such)
//   node tools/build-voice.mjs --lang en --only hello       one group, recorded afresh
//   node tools/build-voice.mjs --force          everything, recorded afresh
//   options: --takes 4 (tries per line)  --jobs 8 (lines at once)  --no-check
//
// Requires ffmpeg and an OpenRouter key (OPENROUTER_API_KEY, or a .env file).
// Languages are listed in tools/voice/index.mjs; the words are in
// tools/voice/<code>.mjs, and her wordless sounds in tools/voice/sounds.mjs.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LANGUAGES, DEFAULT_LANGUAGE, SOUNDS } from './voice/index.mjs';
import { VOICE, MOODS, SOFTER, moodOf, signature, referenceFor } from './voice/persona.mjs';
import { apiKey, speech, transcribe, ask } from './voice/openrouter.mjs';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const ONLY = arg('only', null);
const WANT = arg('lang', null)?.split(',').map((s) => s.trim()).filter(Boolean) || null;
const FORCE = argv.includes('--force');
const CHECK = !argv.includes('--no-check');
const TAKES = Math.max(1, Number(arg('takes', 4)));
const JOBS = Math.max(1, Number(arg('jobs', 8)));
const RATE = 44100;
// who listens to each take: the two transcribers that cope best with a small cartoon voice
const LISTENERS = ['google/gemini-3.5-transcribe', 'openai/whisper-large-v3'];
const OUT_ROOT = fileURLToPath(new URL('../app/assets/voice/', import.meta.url));
const TMP = join(tmpdir(), `lumi-voice-${process.pid}`);

function wavBytes(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}

/** Whatever the speech model sent back (mp3, or raw 16-bit samples) as mono floats at RATE. */
async function decode({ audio, type }, scratch) {
  writeFileSync(scratch, audio);
  const raw = /pcm|l16/i.test(type) ? ['-f', 's16le', '-ar', type.match(/rate=(\d+)/)?.[1] || '24000', '-ac', '1'] : [];
  const { stdout } = await run('ffmpeg', ['-v', 'error', ...raw, '-i', scratch, '-f', 'f32le', '-ac', '1', '-ar', String(RATE), 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 28 });
  rmSync(scratch, { force: true });
  return new Float32Array(stdout.buffer, stdout.byteOffset, stdout.length >> 2).slice();
}

/** Trim silence, even out loudness, add tiny fades. */
function polish(samples, rate) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  if (peak < 1e-4) throw new Error('silent output');
  const thr = peak * 0.02;
  let a = 0, b = samples.length - 1;
  while (a < b && Math.abs(samples[a]) < thr) a++;
  while (b > a && Math.abs(samples[b]) < thr) b--;
  a = Math.max(0, a - Math.floor(rate * 0.012));
  b = Math.min(samples.length - 1, b + Math.floor(rate * 0.05));
  const cut = samples.slice(a, b + 1);
  // loudness: RMS of the voiced parts
  let sum = 0, n = 0;
  for (const s of cut) {
    if (Math.abs(s) > thr) {
      sum += s * s;
      n++;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  const gain = Math.min(0.16 / rms, 0.92 / peak);
  const fi = Math.floor(rate * 0.006), fo = Math.floor(rate * 0.03);
  for (let i = 0; i < cut.length; i++) {
    let g = gain;
    if (i < fi) g *= i / fi;
    if (i > cut.length - fo) g *= (cut.length - i) / fo;
    cut[i] *= g;
  }
  return { samples: cut, rms: rms * gain, peak: peak * gain };
}

/** Median speaking pitch (Hz) by autocorrelation, or 0 if too little of the clip is voiced to say. */
function medianPitch(full, fullRate) {
  // half the sample rate is plenty for a voice, and four times quicker
  const s = new Float32Array(full.length >> 1);
  for (let i = 0; i < s.length; i++) s[i] = (full[2 * i] + full[2 * i + 1]) / 2;
  const rate = fullRate / 2;
  const win = Math.floor(rate * 0.03), hop = Math.floor(rate * 0.01);
  let peak = 0;
  for (const v of s) peak = Math.max(peak, Math.abs(v));
  const lo = Math.floor(rate / 800), hi = Math.floor(rate / 120);
  const r = new Float32Array(hi + 2);
  const found = [];
  for (let st = 0; st + win + hi < s.length; st += hop) {
    let e = 0;
    for (let i = 0; i < win; i++) e += s[st + i] * s[st + i];
    if (Math.sqrt(e / win) < peak * 0.08) continue;
    let best = 0, bestLag = 0;
    for (let lag = lo; lag <= hi; lag++) {
      let c = 0, e2 = 0;
      for (let i = 0; i < win; i++) {
        c += s[st + i] * s[st + i + lag];
        e2 += s[st + i + lag] * s[st + i + lag];
      }
      r[lag] = c / Math.sqrt(e * e2 + 1e-12);
      if (r[lag] > best) {
        best = r[lag];
        bestLag = lag;
      }
    }
    if (best < 0.6) continue;
    // the first strong peak, not the strongest: twice the period fits just as well
    for (let lag = lo + 1; lag < bestLag; lag++) {
      if (r[lag] > best * 0.9 && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
        bestLag = lag;
        break;
      }
    }
    found.push(rate / bestLag);
  }
  if (found.length < 5) return 0;
  found.sort((a, b) => a - b);
  return found[found.length >> 1];
}

const plain = (s) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
const WORDS_SCORE = { same: 2, unchecked: 2, close: 1, different: 0 };

/**
 * Play a take to the listeners. The first one to hear the line settles it;
 * otherwise the kindest verdict stands.
 * @returns {Promise<{words: 'same'|'close'|'different', heard: string}>}
 */
async function listen(wav, text, lang) {
  let best = { words: 'different', heard: '' };
  for (const listener of LISTENERS) {
    const heard = await transcribe(wav, lang.code, listener);
    const words = await compare(text, heard, lang);
    if (WORDS_SCORE[words] > WORDS_SCORE[best.words] || !best.heard) best = { words, heard };
    if (words === 'same') break;
  }
  return best;
}

/** Is that the line? 'same', 'close' (a slip a listener could make on a short, playful line) or 'different'. */
async function compare(text, heard, lang) {
  if (plain(heard) === plain(text)) return 'same';
  if (!plain(heard)) return 'different';
  const answer = await ask(
    `A recording for a toddlers' app should say this line in ${lang.name} (${lang.code}):\n` +
      `LINE: ${text}\n` +
      `A speech recogniser that did not know the line listened to the recording and wrote:\n` +
      `HEARD: ${heard}\n\n` +
      `Is HEARD what you would get from someone saying exactly LINE? Ignore punctuation, capitals, spacing and the ` +
      `writing system (kana or kanji, traditional or simplified characters, a romanisation, digits or words).\n` +
      `Answer with one word:\n` +
      `SAME: the same words and sounds.\n` +
      `CLOSE: the same line, with a slip a recogniser could make on a short or playful utterance: one sound off, a ` +
      `sound-alike word, an animal noise or exclamation spelled another way, a filler such as "oh" added or dropped.\n` +
      `DIFFERENT: words are missing, added or replaced, or it is another language or gibberish.`,
  );
  const word = answer.toUpperCase().match(/SAME|CLOSE|DIFFERENT/)?.[0];
  return word ? word.toLowerCase() : 'different';
}

const recordings = new Map();

/** The recording a language is modelled on, with her usual speaking pitch measured from it. */
async function referenceOf(lang) {
  const ref = referenceFor(lang.code);
  if (!recordings.has(ref.url.href)) {
    const audio = readFileSync(ref.url);
    const home = medianPitch(await decode({ audio, type: 'audio/wav' }, join(TMP, 'reference.src')), RATE);
    recordings.set(ref.url.href, { audio, text: ref.text, home });
  }
  return recordings.get(ref.url.href);
}

async function buildLanguage(lang) {
  const reference = await referenceOf(lang);
  const home = reference.home;
  const outDir = join(OUT_ROOT, lang.code);
  mkdirSync(outDir, { recursive: true });
  const manifestPath = join(outDir, 'manifest.json');
  const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const manifest = { lang: lang.code, name: lang.name, voice: VOICE.model, build: old.build, lines: old.lines || {}, groups: {} };

  // a group of lines is a list of things to say in the mood of the group; a
  // sound brings its own direction and length, and has no words to check
  const groups = Object.entries(lang.lines).map(([group, g]) =>
    Array.isArray(g)
      ? { group, say: g, direction: MOODS[moodOf(group)], longest: 4.8, words: true, spread: VOICE.spread }
      : { group, say: g.say, direction: g.direction, longest: g.longest, words: false, spread: VOICE.soundSpread },
  );
  const jobs = [];
  for (const g of groups) {
    g.say.forEach((text, i) => {
      const id = `${g.group}_${i + 1}`;
      const h = signature(text, g.group, lang.code, g.direction);
      const current = manifest.lines[id]?.h === h && existsSync(join(outDir, `${id}.m4a`));
      if (ONLY ? g.group === ONLY : FORCE || !current) jobs.push({ ...g, id, text, h });
    });
  }
  if (ONLY && !jobs.length) throw new Error(`no group "${ONLY}" in ${lang.code}`);

  /** One attempt at a line: record it, tidy it, and see how it came out. */
  async function take(job, n, softer) {
    const said = softer
      ? await speech({ model: VOICE.model, input: job.text.replace(/[¡!]/g, (c) => (c === '!' ? '.' : '')).replace(/！/g, '。'), instructions: SOFTER, reference })
      : await speech({ model: VOICE.model, input: job.text, instructions: job.direction, reference });
    const p = polish(await decode(said, join(TMP, `${lang.code}-${job.id}-${n}.src`)), RATE);
    const dur = p.samples.length / RATE;
    const hz = medianPitch(p.samples, RATE);
    const t = { ...p, dur, hz, heard: '', words: 'unchecked' };
    t.sane = dur > 0.25 && dur < job.longest; // far too long: she has wandered off the script
    // how far outside her voice, in semitones: above it she squeals, below it she sounds grown up
    t.off = hz && home ? Math.sign(Math.log2(hz / home)) * Math.max(0, Math.abs(12 * Math.log2(hz / home)) - job.spread) : 0;
    t.inVoice = t.off === 0;
    if (CHECK && job.words && t.sane) Object.assign(t, await listen(wavBytes(p.samples, RATE), job.text, lang));
    // the right words in her own voice; a near miss in her voice beats a clean line far out of it
    t.score = (t.sane ? 4 : 0) + WORDS_SCORE[t.words] - Math.min(1.5, Math.abs(t.off) * 0.3);
    t.clean = t.sane && t.inVoice && WORDS_SCORE[t.words] === 2;
    return t;
  }

  async function render(job) {
    let best = null, takes = 0, problem = null, softer = false;
    while (takes < TAKES && !best?.clean) {
      // "nearly" twice running is how a listener hears a lone "Red!" ("Read."): a third take will not change its mind
      if (takes >= 2 && best?.words === 'close' && best.sane && best.inVoice) break;
      takes++;
      try {
        const t = await take(job, takes, softer);
        if (!best || t.score > best.score) best = t;
        if (t.off > 0 && job.words) softer = true; // she squealed a line: from now on, softly
      } catch (e) {
        problem = e;
        if (/OpenRouter .*: 4\d\d/.test(e.message)) break; // refused: no point in asking again
      }
    }
    if (!best) throw problem;
    const wav = join(TMP, `${lang.code}-${job.id}.wav`);
    writeFileSync(wav, wavBytes(best.samples, RATE));
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ar', String(RATE), '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', join(outDir, `${job.id}.m4a`)]);
    rmSync(wav, { force: true });
    manifest.lines[job.id] = { t: job.text, d: +best.dur.toFixed(3), h: job.h };
    return { ...job, ...best, samples: null, takes };
  }

  const results = [];
  const queue = jobs.slice();
  let failures = 0;
  await Promise.all(
    Array.from({ length: JOBS }, async () => {
      while (queue.length) {
        const job = queue.shift();
        try {
          results.push(await render(job));
        } catch (e) {
          failures++;
          console.error(`  FAILED ${lang.code}/${job.id} "${job.text}": ${e.message}`);
        }
      }
    }),
  );

  // rebuild groups in source order, and drop audio for lines that no longer exist
  for (const g of groups) {
    manifest.groups[g.group] = g.say.map((_, i) => `${g.group}_${i + 1}`).filter((id) => manifest.lines[id]);
  }
  const valid = new Set(Object.values(manifest.groups).flat());
  for (const id of Object.keys(manifest.lines)) if (!valid.has(id)) delete manifest.lines[id];
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.m4a') && !valid.has(f.slice(0, -4))) rmSync(join(outDir, f));
  }
  // the app fetches audio by build id, so a new one makes it pick up the new recordings
  if (results.length || !manifest.build) manifest.build = Date.now().toString(36);
  writeFileSync(manifestPath, JSON.stringify(manifest));

  const pitches = results.map((r) => r.hz).filter(Boolean).sort((a, b) => a - b);
  const total = Object.values(manifest.lines).reduce((s, l) => s + l.d, 0);
  const longest = results.slice().sort((a, b) => b.dur - a.dur)[0];
  console.log(
    `${lang.code}  ${lang.name.padEnd(10)} ${String(results.length).padStart(3)} recorded of ${String(valid.size).padStart(3)} lines (${total.toFixed(0)}s in all)` +
      (results.length
        ? `  ${results.reduce((s, r) => s + r.takes, 0)} takes  voice ~${(pitches[pitches.length >> 1] || 0).toFixed(0)} Hz (hers: ${home.toFixed(0)})  ` +
          `longest ${longest.dur.toFixed(2)}s  peak ${Math.max(...results.map((r) => r.peak)).toFixed(2)}`
        : ''),
  );
  // anything that did not come out clean, for a human ear
  for (const r of results.filter((r) => !r.clean).sort((a, b) => a.score - b.score)) {
    const why = [];
    if (!r.sane) why.push(`lasts ${r.dur.toFixed(1)}s`);
    if (r.words === 'different') why.push(`sounded like "${r.heard}"`);
    else if (r.words === 'close') why.push(`nearly: heard "${r.heard}"`);
    if (!r.inVoice) why.push(`pitch ${r.hz.toFixed(0)} Hz`);
    console.log(`    ${r.words === 'different' || !r.sane ? 'LISTEN' : 'note  '} ${lang.code}/${r.id} "${r.text}": ${why.join(', ')}`);
  }
  return failures;
}

apiKey(); // stop here, with a helpful message, if there is no key
mkdirSync(OUT_ROOT, { recursive: true });
mkdirSync(TMP, { recursive: true });
console.log(`Lumi's voice: ${VOICE.model}`);
const targets = [...LANGUAGES, SOUNDS].filter((l) => !WANT || WANT.includes(l.code));
if (WANT) for (const code of WANT) if (!targets.some((l) => l.code === code)) console.error(`unknown language "${code}"`);
let failed = 0;
for (const lang of targets) {
  try {
    failed += await buildLanguage(lang);
  } catch (e) {
    failed++;
    console.error(`${lang.code}: ${e.message}`);
  }
}

// the app's list of languages: every one that has been rendered
const available = LANGUAGES.filter((l) => existsSync(join(OUT_ROOT, l.code, 'manifest.json')));
writeFileSync(
  join(OUT_ROOT, 'languages.json'),
  JSON.stringify({ default: DEFAULT_LANGUAGE, languages: available.map((l) => ({ code: l.code, name: l.name })) }),
);
// tidy up anything from the days when Lumi only spoke one language
for (const f of readdirSync(OUT_ROOT)) {
  const p = join(OUT_ROOT, f);
  if (statSync(p).isFile() && (f.endsWith('.m4a') || f === 'manifest.json')) rmSync(p);
}
rmSync(TMP, { recursive: true, force: true });
console.log(`languages available: ${available.map((l) => l.code).join(', ')}`);
if (failed) process.exitCode = 1;
