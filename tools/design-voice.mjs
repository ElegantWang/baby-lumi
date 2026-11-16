// Invents new voices for Lumi to choose from. Given only a written description,
// the speech model makes up a voice each time it is asked, so this records a
// handful of candidates saying the same short script. Listen to them, and if
// you like one better than her current voice, make it hers:
//
//   node tools/design-voice.mjs                       six candidates in voice-candidates/
//   node tools/design-voice.mjs --count 12 --describe "A sleepy little bear cub with a soft, round voice."
//   cp voice-candidates/3.wav tools/voice/lumi.wav    choose number 3
//   npm run build:voice                               record every line again in the new voice
//
// If you changed the description, copy it into tools/voice/persona.mjs too.
//
// A voice keeps the accent of its recording, so some languages have one of
// their own (REFERENCES in persona.mjs). To make one, have the candidates say
// a few sentences in that language, and save your choice as lumi.<code>.wav:
//
//   node tools/design-voice.mjs --say "¡Hola! ¡Soy Lumi! Me encanta jugar contigo."
//   cp voice-candidates/2.wav tools/voice/lumi.es.wav   and list it, with those words, in REFERENCES
// Requires ffmpeg and an OpenRouter key (OPENROUTER_API_KEY, or a .env file).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { VOICE, referenceFor } from './voice/persona.mjs';
import { apiKey, speech } from './voice/openrouter.mjs';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const COUNT = Math.max(1, Number(arg('count', 6)));
const DESCRIBE = arg('describe', VOICE.description);
const SAY = arg('say', referenceFor('en').text);
const OUT = resolve(fileURLToPath(new URL('..', import.meta.url)), arg('out', 'voice-candidates'));

apiKey();
mkdirSync(OUT, { recursive: true });
console.log(`"${DESCRIBE}"`);
await Promise.all(
  Array.from({ length: COUNT }, async (_, i) => {
    const n = i + 1;
    try {
      const { audio } = await speech({ model: VOICE.model, input: SAY, instructions: DESCRIBE });
      const src = join(OUT, `${n}.mp3`), wav = join(OUT, `${n}.wav`);
      writeFileSync(src, audio);
      // the same plain format as tools/voice/lumi.wav, with silence trimmed from both ends
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-af',
        'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse',
        '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
      rmSync(src);
      console.log(`  ${wav}`);
    } catch (e) {
      console.error(`  candidate ${n} failed: ${e.message}`);
      process.exitCode = 1;
    }
  }),
);
console.log('Listen to them (for example: afplay voice-candidates/1.wav), then see the top of this file.');
