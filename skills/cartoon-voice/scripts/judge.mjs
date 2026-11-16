// Asks models that can listen what a voice sounds like. You cannot hear; they
// can, after a fashion. Each judge is played a clip, told only who the voice is
// meant for (never which candidate it is, or what you hope to hear), and rates
// it: cute, cartoonish, robotic, warm, clear, shrill, native accent, and whether
// it is one and the same character throughout.
//
//   node judge.mjs voice-candidates/*.wav               each file is a candidate voice
//   node judge.mjs old/en new/en --lang English         each folder is one voice: a sample of its clips, joined
//   options: --lang "Brazilian Portuguese"   the language spoken (default English)
//            --brief "a small, cuddly cartoon animal in an app for children aged 2 to 4"
//            --sample 8      how many clips of a folder to join (evenly spread)
//            --judges a,b    which models listen        --json file   save every answer
//
// Scores are opinions of models, not measurements, and one judge alone is
// noise: read the average of several, and the words ("sounds like") beside the
// numbers. They rank candidates well enough to make a shortlist. They do not
// replace a person listening.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs, pool, stop } from './lib/args.mjs';
import { AUDIO_FILE, decodeFile, joined, pitch } from './lib/audio.mjs';
import { DEFAULTS, apiKey, hear } from './lib/openrouter.mjs';

const usage = 'node judge.mjs <clip or folder>... [--lang English] [--brief "..."] [--sample 8] [--judges a,b] [--json file]';
const args = parseArgs({ valued: ['lang', 'brief', 'sample', 'judges', 'json'], usage });
if (!args.rest.length) stop(usage);
const LANG = args.opt('lang', 'English');
const BRIEF = args.opt('brief', 'a small, cuddly cartoon character in an app for children aged 2 to 4');
const SAMPLE = Math.max(1, Number(args.opt('sample', 8)));
const JUDGES = args.list('judges', DEFAULTS.judges);

const PROMPT = `You are casting the voice of ${BRIEF}. The clip contains one candidate voice speaking in ${LANG}; if there are several lines, they are separate recordings of the same candidate. Judge only what you hear, as a native ${LANG} speaker would.

Reply with JSON only, no code fence:
{"sounds_like": "<who this sounds like, e.g. 'adult woman reading aloud', 'young child', 'cartoon animal character', 'synthetic assistant voice'>",
 "cute": <1-10, how cute and endearing>,
 "cartoonish": <1-10, how much it sounds like an animated character rather than an ordinary person>,
 "robotic": <1-10, how synthetic, flat or machine-like; 1 = fully natural and expressive>,
 "warm": <1-10>,
 "clear": <1-10, how easily a small child would understand the words>,
 "shrill": <1-10, how harsh, piercing or grating; 1 = pleasant>,
 "native": <1-10, 10 = sounds like a native ${LANG} speaker, 1 = heavy foreign accent>,
 "accent": "<the accent you hear, or 'none'>",
 "consistent": <1-10, one and the same character from start to end; 10 = identical voice throughout>,
 "artifacts": "<glitches, noise, clipped or extra words, odd pauses, or 'none'>",
 "note": "<one sentence>"}`;

apiKey();
// what to play: a file is a voice; a folder is a voice heard through a sample of its clips
const voices = [];
for (const path of args.rest) {
  let files;
  try {
    files = statSync(path).isDirectory() ? readdirSync(path).filter((f) => AUDIO_FILE.test(f)).sort().map((f) => join(path, f)) : [path];
  } catch {
    stop(`no such file or folder: ${path}`);
  }
  if (!files.length) stop(`no audio files in ${path}`);
  if (files.length > SAMPLE) files = Array.from({ length: SAMPLE }, (_, i) => files[Math.floor((i * files.length) / SAMPLE)]);
  voices.push({ name: path.replace(/\/$/, ''), files });
}
// shorter names when they stay distinct
const short = voices.map((v) => basename(v.name).replace(AUDIO_FILE, ''));
if (new Set(short).size === short.length) voices.forEach((v, i) => (v.name = short[i]));

for (const v of voices) {
  v.wav = await joined(v.files);
  // how high the voice is: the middle one of its clips
  const heard = [];
  for (const f of v.files) heard.push(pitch(await decodeFile(f)).median);
  heard.sort((a, b) => a - b);
  v.hz = heard.filter(Boolean)[heard.filter(Boolean).length >> 1] || 0;
}

const jobs = voices.flatMap((v) => JUDGES.map((judge) => ({ v, judge })));
// audio answers are slow (about half a minute each), and slower still when many are asked at once
console.error(`${voices.length} voice${voices.length > 1 ? 's' : ''}, ${JUDGES.length} judge${JUDGES.length > 1 ? 's' : ''} each: about ${Math.max(1, Math.ceil((jobs.length * 30) / 3 / 60))} min`);
let done = 0;
const rows = await pool(jobs, 3, async ({ v, judge }) => {
  let row;
  try {
    const text = await hear(v.wav, PROMPT, judge);
    row = { voice: v.name, judge, ...JSON.parse(text.match(/\{[\s\S]*\}/)[0]) };
  } catch (e) {
    row = { voice: v.name, judge, error: e.message.slice(0, 160) };
  }
  console.error(`  ${++done}/${jobs.length}  ${v.name}: ${judge} ${row.error ? 'gave no answer' : 'has listened'}`);
  return row;
});
if (args.opt('json')) writeFileSync(args.opt('json'), JSON.stringify(rows, null, 1));

const KEYS = ['cute', 'cartoonish', 'warm', 'clear', 'robotic', 'shrill', 'native', 'consistent'];
const table = voices.map((v) => {
  const mine = rows.filter((r) => r.voice === v.name);
  const good = mine.filter((r) => !r.error && Number(r.cute) > 0);
  const avg = Object.fromEntries(KEYS.map((k) => [k, good.length ? good.reduce((s, r) => s + Number(r[k] || 0), 0) / good.length : 0]));
  // what is wanted: cute, cartoonish, warm and clear, and neither robotic nor shrill
  return { ...v, mine, good, avg, score: avg.cute + avg.cartoonish + avg.warm + avg.clear - avg.robotic - avg.shrill };
});
table.sort((a, b) => b.score - a.score);

const width = Math.max(5, ...table.map((t) => t.name.length));
console.log(`${'voice'.padEnd(width)}  score  ${KEYS.map((k) => k.slice(0, 6).padStart(6)).join(' ')}  pitch  judges`);
for (const t of table) {
  console.log(
    `${t.name.padEnd(width)}  ${t.good.length ? t.score.toFixed(1).padStart(5) : '    -'}  ${KEYS.map((k) => (t.good.length ? t.avg[k].toFixed(1) : '-').padStart(6)).join(' ')}  ` +
      `${t.hz ? String(Math.round(t.hz)).padStart(3) + 'Hz' : '    -'}  ${t.good.length}/${t.mine.length}`,
  );
}
console.log('\n(score = cute + cartoonish + warm + clear - robotic - shrill, so 40 is the most and about 28 is good; every number is a model\'s opinion)\n');
for (const t of table) {
  console.log(`${t.name}:`);
  for (const r of t.mine) {
    console.log(
      r.error
        ? `  ${r.judge}: no answer (${r.error})`
        : `  ${r.judge}: ${r.sounds_like}; accent: ${r.accent || 'none'}${r.artifacts && !/^none/i.test(r.artifacts) ? `; artifacts: ${r.artifacts}` : ''}. ${r.note || ''}`,
    );
  }
}
if (table.every((t) => !t.good.length)) process.exitCode = 1;
