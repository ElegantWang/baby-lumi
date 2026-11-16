// Records lines in a character's voice. The voice is a short recording (see
// design-voice.mjs) that the speech model imitates for every line, so she is
// the same character throughout. Each line is trimmed, evened out in loudness
// and written to <out>/<language>/<id>.<format>, with a manifest.json beside
// them (the text, length and fingerprint of every line).
//
// A speech model is an actor, not a tape recorder: now and then it fluffs a
// word, squeals, or drifts out of character. So every take is checked. Two
// transcribers write down what they hear, which is compared with the line; the
// pitch is measured against the voice's own; and a take that runs far too long
// has wandered off the script. A take that fails is recorded again (more
// softly, if it squealed), and the best take is kept. Lines that never came
// out clean are listed at the end for a person to listen to. Transcribers
// mishear small cartoon voices too, above all a lone "Moo!", so "LISTEN" means
// just that, not "wrong".
//
//   node record.mjs --voice voice.json --lines lines.json --out assets/voice
//                                     whatever is new or has changed since last time
//   ... --lang es,fr                  just these languages
//   ... --only hello                  just the lines called hello or hello_<something>, recorded afresh
//   ... --force                       everything, recorded afresh
//   ... --dry-run                     say what would be recorded, and stop
//   options: --format m4a|mp3|ogg|opus|wav (m4a)   --takes 4 (tries per line)   --jobs 8 (lines at once)
//            --no-check (do not transcribe)        --report file.json (every take's measurements)
//
// The two input files are described in SKILL.md; examples are in assets/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs, pool, stop } from './lib/args.mjs';
import { FORMATS, RATE, decode, decodeFile, encode, pitch, polish, wavBytes } from './lib/audio.mjs';
import { DEFAULTS, apiKey, ask, speech, transcribe } from './lib/openrouter.mjs';

const usage =
  'node record.mjs --voice voice.json --lines lines.json --out <folder> [--lang a,b] [--only <id>] [--force] [--dry-run]\n' +
  '                [--format m4a] [--takes 4] [--jobs 8] [--no-check] [--report file.json]';
const args = parseArgs({ valued: ['voice', 'lines', 'out', 'lang', 'only', 'takes', 'jobs', 'format', 'report'], flags: ['force', 'no-check', 'dry-run'], usage });
for (const need of ['voice', 'lines', 'out']) if (!args.opt(need)) stop(`--${need} is needed\n\n${usage}`);
const ONLY = args.opt('only', null);
const WANT = args.list('lang', null);
const FORCE = args.has('force');
const CHECK = !args.has('no-check');
const DRY = args.has('dry-run');
const TAKES = Math.max(1, Number(args.opt('takes', 4)));
const JOBS = Math.max(1, Number(args.opt('jobs', 8)));
const FORMAT = args.opt('format', 'm4a');
if (!FORMATS.includes(FORMAT)) stop(`--format must be one of ${FORMATS.join(', ')}`);
const OUT = resolve(args.opt('out'));

const readJson = (path, what) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    stop(`cannot read the ${what} file ${path}: ${e.message}`);
  }
};

// ---- the voice -------------------------------------------------------------
const voicePath = resolve(args.opt('voice'));
const voice = readJson(voicePath, 'voice');
const MODEL = voice.model || DEFAULTS.speech;
const MOODS = voice.moods || {};
const SOFTER = voice.softer || 'sweet, friendly and calm';
// how far (in semitones) a take may stray from the pitch of the recording before
// it no longer sounds like the character; a giggle may go higher than a sentence
const SPREAD = voice.spread ?? 5.5;
const SOUND_SPREAD = voice.soundSpread ?? 8.5;
const LISTENERS = voice.listeners || DEFAULTS.listeners;
const AUDIENCE = voice.audience || "a children's app";
if (!voice.references?.default) stop(`${voicePath} needs "references": {"default": {"file": "...wav", "text": "exactly what is said in it"}}`);
for (const [code, r] of Object.entries(voice.references)) {
  if (!r?.file || !r?.text) stop(`${voicePath}: reference "${code}" needs both "file" and "text"`);
  if (!existsSync(resolve(dirname(voicePath), r.file))) stop(`${voicePath}: reference "${code}" points at ${r.file}, which does not exist`);
}
if (voice.defaultMood && !MOODS[voice.defaultMood]) stop(`${voicePath}: defaultMood "${voice.defaultMood}" is not one of its moods`);

const references = new Map();
/** The recording a language is modelled on, with the voice's usual pitch measured from it. */
async function referenceFor(code) {
  const r = voice.references[code] || voice.references.default;
  const path = resolve(dirname(voicePath), r.file);
  if (!references.has(path)) {
    const audio = readFileSync(path);
    references.set(path, { audio, text: r.text, sha: createHash('sha1').update(audio).digest('hex'), home: pitch(await decodeFile(path)).median });
  }
  return references.get(path);
}

// ---- the lines -------------------------------------------------------------
const linesPath = resolve(args.opt('lines'));
const linesFile = readJson(linesPath, 'lines');
// "_moods": {"sleepy": ["night", "yawn"]} gives every line called night, or night_<something>, that mood in every language
const moodOfId = (id) => {
  for (const [mood, ids] of Object.entries(linesFile._moods || {})) if (ids.some((p) => id === p || id.startsWith(p + '_'))) return mood;
  return voice.defaultMood;
};
for (const mood of Object.keys(linesFile._moods || {})) if (!MOODS[mood]) stop(`${linesPath}: "_moods" names the mood "${mood}", which ${voicePath} does not describe`);
// an id in "_moods" that matches no line is a slip of the keyboard, and would quietly leave lines in the default mood
const everyId = Object.entries(linesFile).flatMap(([code, entries]) => (code.startsWith('_') ? [] : Object.keys(entries)));
for (const [mood, ids] of Object.entries(linesFile._moods || {})) {
  for (const p of ids) if (!everyId.some((id) => id === p || id.startsWith(p + '_'))) stop(`${linesPath}: "_moods" gives "${p}" the mood ${mood}, but no line is called ${p} or ${p}_<something>`);
}

const CJK = /[぀-ヿ㐀-鿿가-힯]/g;
/** The longest a line could reasonably take, about three times an unhurried reading. */
const longestFor = (text) => 1.5 + 0.2 * text.length + 0.5 * (text.match(CJK)?.length || 0);
const nameOf = (code) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
};

const languages = [];
for (const [code, entries] of Object.entries(linesFile)) {
  if (code.startsWith('_')) continue;
  if (WANT && !WANT.includes(code)) continue;
  const lines = [];
  for (const [id, entry] of Object.entries(entries)) {
    const line = typeof entry === 'string' ? { text: entry } : entry;
    if (!/^[\w.-]+$/.test(id)) stop(`${linesPath}: "${id}" (${code}) becomes a file name, so use only letters, digits, _ . and -`);
    if (typeof line?.text !== 'string' || !line.text.trim()) stop(`${linesPath}: ${code}/${id} has no text`);
    if (line.mood && !MOODS[line.mood]) stop(`${linesPath}: ${code}/${id} has the mood "${line.mood}", which ${voicePath} does not describe`);
    const mood = line.mood || moodOfId(id);
    lines.push({
      id,
      text: line.text,
      mood: line.direction != null ? 'own direction' : mood || 'no direction',
      direction: line.direction ?? (mood ? MOODS[mood] : undefined),
      // a sound (a giggle, "wheee!") has no words to check, and may go higher
      words: !line.sound,
      spread: line.sound ? SOUND_SPREAD : SPREAD,
      longest: line.longest ?? longestFor(line.text),
    });
  }
  languages.push({ code, name: nameOf(code), lines });
}
if (WANT) for (const code of WANT) if (!languages.some((l) => l.code === code)) stop(`${linesPath} has no language "${code}"`);
if (!languages.length) stop(`${linesPath} has no languages in it`);

/** A short fingerprint of everything that decides how a line sounds, so lines that are up to date can be skipped. */
const signature = (line, ref) => createHash('sha1').update([MODEL, ref.sha, ref.text, line.direction || '', line.text].join('\n')).digest('hex').slice(0, 10);

// ---- listening to a take ---------------------------------------------------
const plain = (s) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
const WORDS_SCORE = { same: 2, unchecked: 2, close: 1, different: 0 };

/** Play a take to the listeners. The first to hear the line settles it; otherwise the kindest verdict stands. */
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
    `A recording for ${AUDIENCE} should say this line in ${lang.name} (${lang.code}):\n` +
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
    voice.comparer || DEFAULTS.comparer,
  );
  const word = answer.toUpperCase().match(/SAME|CLOSE|DIFFERENT/)?.[0];
  return word ? word.toLowerCase() : 'different';
}

// ---- recording a language ---------------------------------------------------
async function record(lang) {
  const reference = await referenceFor(lang.code);
  const home = reference.home;
  const outDir = join(OUT, lang.code);
  const manifestPath = join(outDir, 'manifest.json');
  const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const fileOf = (id, format = FORMAT) => join(outDir, `${id}.${format}`);
  // another format than last time means recording every line again, so not something to do to a few lines
  const reformat = Boolean(old.format && old.format !== FORMAT);
  if (reformat && ONLY) throw new Error(`${outDir} holds .${old.format} recordings; to change to .${FORMAT}, run without --only`);
  const manifest = { lang: lang.code, name: lang.name, voice: MODEL, format: FORMAT, build: old.build, lines: reformat ? {} : old.lines || {} };

  const jobs = [];
  for (const line of lang.lines) {
    const h = signature(line, reference);
    const current = manifest.lines[line.id]?.h === h && existsSync(fileOf(line.id));
    if (ONLY ? line.id === ONLY || line.id.startsWith(ONLY + '_') : FORCE || !current) jobs.push({ ...line, h });
  }
  if (DRY) {
    console.log(`${lang.code.padEnd(6)}  ${lang.name.padEnd(12)} ${String(jobs.length).padStart(4)} of ${String(lang.lines.length).padStart(4)} lines to record${jobs.length ? `: ${jobs.slice(0, 8).map((j) => j.id).join(', ')}${jobs.length > 8 ? ', ...' : ''}` : ''}`);
    // which mood each line would be said in, to catch a line that fell into the wrong one
    const byMood = {};
    for (const l of lang.lines) (byMood[l.mood] ||= []).push(l.id);
    for (const [mood, ids] of Object.entries(byMood)) console.log(`          ${mood}: ${ids.slice(0, 10).join(', ')}${ids.length > 10 ? `, ... (${ids.length} lines)` : ''}`);
    return { failures: 0, recorded: jobs.length, results: [] };
  }
  mkdirSync(outDir, { recursive: true });

  /** One attempt at a line: record it, tidy it, and see how it came out. */
  async function take(job, softer) {
    const said = softer
      ? await speech({ model: MODEL, input: job.text.replace(/[¡!]/g, (c) => (c === '!' ? '.' : '')).replace(/！/g, '。'), instructions: SOFTER, reference })
      : await speech({ model: MODEL, input: job.text, instructions: job.direction, reference });
    const p = polish(await decode(said));
    const dur = p.samples.length / RATE;
    const hz = pitch(p.samples).median;
    const t = { ...p, dur, hz, heard: '', words: 'unchecked', softer };
    t.sane = dur > 0.25 && dur < job.longest; // far too long: she has wandered off the script
    // how far outside the voice, in semitones: above it she squeals, below it she sounds grown up
    t.off = hz && home ? Math.sign(Math.log2(hz / home)) * Math.max(0, Math.abs(12 * Math.log2(hz / home)) - job.spread) : 0;
    t.inVoice = t.off === 0;
    if (CHECK && job.words && t.sane) Object.assign(t, await listen(wavBytes(p.samples), job.text, lang));
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
        const t = await take(job, softer);
        if (!best || t.score > best.score) best = t;
        if (t.off > 0 && job.words) softer = true; // she squealed a line: from now on, softly
      } catch (e) {
        problem = e;
        if (/OpenRouter .*: 4\d\d/.test(e.message)) break; // refused: no point in asking again
      }
    }
    if (!best) throw problem;
    await encode(best.samples, fileOf(job.id));
    manifest.lines[job.id] = { t: job.text, d: +best.dur.toFixed(3), h: job.h };
    return { ...job, ...best, samples: undefined, takes };
  }

  let failures = 0;
  const results = (
    await pool(jobs, JOBS, async (job) => {
      try {
        return await render(job);
      } catch (e) {
        failures++;
        console.error(`  FAILED ${lang.code}/${job.id} "${job.text}": ${e.message}`);
        return null;
      }
    })
  ).filter(Boolean);

  // lines in source order; drop the audio of lines that are gone (only files this tool made)
  const wanted = new Set(lang.lines.map((l) => l.id));
  for (const id of Object.keys(old.lines || {})) {
    if (reformat) rmSync(fileOf(id, old.format), { force: true });
    if (!wanted.has(id)) rmSync(fileOf(id), { force: true });
  }
  manifest.lines = Object.fromEntries(lang.lines.filter((l) => manifest.lines[l.id]).map((l) => [l.id, manifest.lines[l.id]]));
  // a new build id whenever anything was recorded, so an app can tell its cached audio is stale
  if (results.length || !manifest.build) manifest.build = Date.now().toString(36);
  writeFileSync(manifestPath, JSON.stringify(manifest));

  const pitches = results.map((r) => r.hz).filter(Boolean).sort((a, b) => a - b);
  const total = Object.values(manifest.lines).reduce((s, l) => s + l.d, 0);
  console.log(
    `${lang.code.padEnd(6)}  ${lang.name.padEnd(12)} ${String(results.length).padStart(4)} recorded of ${String(lang.lines.length).padStart(4)} lines (${total.toFixed(0)}s in all)` +
      (results.length
        ? `  ${results.reduce((s, r) => s + r.takes, 0)} takes  these lines ~${(pitches[pitches.length >> 1] || 0).toFixed(0)} Hz (the recording: ${home.toFixed(0)} Hz)  ` +
          `longest ${Math.max(...results.map((r) => r.dur)).toFixed(2)}s`
        : ''),
  );
  // anything that did not come out clean, for a human ear
  for (const r of results.filter((r) => !r.clean).sort((a, b) => a.score - b.score)) {
    const why = [];
    if (!r.sane) why.push(`lasts ${r.dur.toFixed(1)}s`);
    if (r.words === 'different') why.push(`sounded like "${r.heard}"`);
    else if (r.words === 'close') why.push(`nearly: heard "${r.heard}"`);
    if (!r.inVoice) why.push(`pitch ${r.hz.toFixed(0)} Hz`);
    console.log(`    ${r.words === 'different' || !r.sane ? 'LISTEN' : 'note  '} ${relative(process.cwd(), fileOf(r.id))} "${r.text}": ${why.join(', ')}`);
  }
  return {
    failures,
    recorded: results.length,
    results: results.map((r) => ({ lang: lang.code, id: r.id, text: r.text, file: fileOf(r.id), takes: r.takes, clean: r.clean, seconds: +r.dur.toFixed(2), hz: Math.round(r.hz), semitonesOutOfVoice: +r.off.toFixed(1), words: r.words, heard: r.heard, softer: r.softer })),
  };
}

if (!DRY) apiKey(); // stop here, with a helpful message, if there is no key
console.log(`${voice.name ? voice.name + "'s voice" : 'voice'}: ${MODEL}${DRY ? '  (dry run: nothing is recorded)' : ''}`);
let failed = 0, recorded = 0;
const report = [];
for (const lang of languages) {
  try {
    const r = await record(lang);
    failed += r.failures;
    recorded += r.recorded;
    report.push(...r.results);
  } catch (e) {
    failed++;
    console.error(`${lang.code}: ${e.message}`);
  }
}
if (DRY && !recorded) console.log('Nothing to record: every line is up to date.');
else if (DRY) console.log(`${recorded} line${recorded > 1 ? 's' : ''} in all; at November 2026 prices that is roughly $${Math.max(0.01, recorded * 0.001).toFixed(2)} (about a tenth of a cent a line, retakes and checks included).`);
else if (args.opt('report')) writeFileSync(resolve(args.opt('report')), JSON.stringify(report, null, 1));
if (failed) {
  console.error(`${failed} line${failed > 1 ? 's' : ''} could not be recorded at all; run again to retry just those.`);
  process.exitCode = 1;
}
