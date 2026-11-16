// Invents voices to choose from. Given only a written description, the speech
// model makes up a new voice every time it is asked, so this records a handful
// of candidates saying the same short script. Each is saved as a WAV file, and
// measured: how high the voice is, and how much it moves.
//
//   node design-voice.mjs --describe "The voice of a small fluffy baby animal in an animated preschool series: ..." \
//                         --say "Hi! I'm Pip! I love playing with you. ..." [--count 8] [--out voice-candidates]
//
// Run it again to add more candidates (numbering carries on; nothing is
// overwritten). What each candidate was asked to say is kept in
// candidates.json in the same folder: the recording you choose is only usable
// as a voice together with exactly the words spoken in it.
//
// For a language that needs a recording of its own, give the same description
// and a --say in that language, and a separate --out folder.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs, pool, stop } from './lib/args.mjs';
import { decodeFile, pitch } from './lib/audio.mjs';
import { DEFAULTS, apiKey, speech } from './lib/openrouter.mjs';

const usage = 'node design-voice.mjs --describe "<the voice>" --say "<what candidates say>" [--count 8] [--out voice-candidates] [--model <speech model>]';
const args = parseArgs({ valued: ['describe', 'say', 'count', 'out', 'model'], usage });
const DESCRIBE = args.opt('describe');
const SAY = args.opt('say');
if (!DESCRIBE || !SAY) stop(`--describe and --say are both needed\n\n${usage}`);
const COUNT = Math.max(1, Number(args.opt('count', 8)));
const MODEL = args.opt('model', DEFAULTS.speech);
const OUT = resolve(args.opt('out', 'voice-candidates'));

apiKey();
mkdirSync(OUT, { recursive: true });
const notesPath = join(OUT, 'candidates.json');
const notes = existsSync(notesPath) ? JSON.parse(readFileSync(notesPath, 'utf8')) : {};
const first = Math.max(0, ...readdirSync(OUT).map((f) => Number(f.match(/^(\d+)\.wav$/)?.[1] || 0))) + 1;

console.log(`${MODEL}: "${DESCRIBE}"`);
const made = await pool(Array.from({ length: COUNT }, (_, i) => first + i), 6, async (n) => {
  const src = join(OUT, `${n}.mp3`), wav = join(OUT, `${n}.wav`);
  try {
    const { audio } = await speech({ model: MODEL, input: SAY, instructions: DESCRIBE });
    writeFileSync(src, audio);
    // a plain 24 kHz mono WAV with silence trimmed from both ends: what the model takes as a voice to imitate
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-af',
      'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse',
      '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
    const samples = await decodeFile(wav);
    const p = pitch(samples);
    return { n, file: relative(process.cwd(), wav), hz: Math.round(p.median), range: +p.range.toFixed(1), seconds: +(samples.length / 44100).toFixed(1) };
  } catch (e) {
    return { n, error: e.message };
  } finally {
    rmSync(src, { force: true });
  }
});

for (const c of made) {
  if (c.error) {
    console.error(`  ${String(c.n).padStart(3)}  failed: ${c.error}`);
    process.exitCode = 1;
    continue;
  }
  notes[c.n] = { model: MODEL, description: DESCRIBE, say: SAY, hz: c.hz, range: c.range, seconds: c.seconds };
  console.log(`  ${String(c.n).padStart(3)}  ${c.file}  ${String(c.hz).padStart(4)} Hz  moves ${String(c.range).padStart(4)} semitones  ${c.seconds}s`);
}
writeFileSync(notesPath, JSON.stringify(notes, null, 1));
const here = relative(process.cwd(), OUT) || '.';
console.log(`What each one says is noted in ${join(here, 'candidates.json')}. Next: judge.mjs ${join(here, '*.wav')} (add --lang "<language>" if they are not speaking English), and listen-page.mjs ${here} for a person to listen.`);
