// Is everything in place to make a voice? Checks ffmpeg, the OpenRouter key and
// its credit, and that the models these tools use by default still exist.
//
//   node check-setup.mjs            the checks
//   node check-setup.mjs --models   also list every speech, transcription and audio-listening model on offer
//   node check-setup.mjs --spend    only what the key has spent so far (run before and after to see what a job cost)
import { execFileSync } from 'node:child_process';
import { basename, dirname } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { DEFAULTS, credit, keySource, models } from './lib/openrouter.mjs';

const args = parseArgs({ flags: ['models', 'spend'], usage: 'node check-setup.mjs [--models | --spend]' });
if (args.has('spend')) {
  const c = await credit();
  console.log(`$${Number(c.usage).toFixed(2)} spent on this key so far${c.remaining != null ? `, $${Number(c.remaining).toFixed(2)} left` : ''}`);
  process.exit(0);
}
let bad = 0;
const ok = (good, text) => {
  console.log(`${good ? 'ok  ' : 'FIX '} ${text}`);
  if (!good) bad++;
};

ok(Number(process.versions.node.split('.')[0]) >= 18, `Node ${process.versions.node} (18 or newer is needed)`);
try {
  ok(true, execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0]);
} catch {
  ok(false, 'ffmpeg is not installed (macOS: brew install ffmpeg)');
}

let haveKey = false;
try {
  const file = keySource();
  const c = await credit();
  haveKey = true;
  const spent = c.usage != null ? `$${Number(c.usage).toFixed(2)} spent` : 'spend unknown';
  const left = c.remaining != null ? `, $${Number(c.remaining).toFixed(2)} left of its $${c.limit} limit` : ', no spending limit set';
  ok(c.remaining == null || c.remaining > 0.5, `OpenRouter key works: ${spent}${left}`);
  // a key in a file that git would pick up is one "add everything" away from being published
  if (file) {
    const git = (...a) => {
      try {
        execFileSync('git', ['-C', dirname(file), ...a], { stdio: 'ignore' });
        return 0;
      } catch (e) {
        return e.status ?? 128;
      }
    };
    if (git('rev-parse', '--git-dir') === 0) {
      const tracked = git('ls-files', '--error-unmatch', basename(file)) === 0;
      const ignored = git('check-ignore', '-q', basename(file)) === 0;
      if (tracked) ok(false, `${file} holds the key and is tracked by git: take the file out of the repository, and replace the key if it was ever pushed`);
      else ok(ignored, `${file} holds the key and git ${ignored ? 'ignores it' : 'does not ignore it: add .env to .gitignore'}`);
    }
  }
} catch (e) {
  ok(false, e.message);
}

if (haveKey) {
  const jobs = [
    { what: 'speech', query: 'output_modalities=speech', want: [DEFAULTS.speech] },
    { what: 'transcription', query: 'output_modalities=transcription', want: DEFAULTS.listeners },
    { what: 'listening (chat models that take audio)', query: 'input_modalities=audio&output_modalities=text', want: DEFAULTS.judges },
    { what: 'text', query: '', want: [DEFAULTS.comparer], quiet: true },
  ];
  for (const job of jobs) {
    try {
      const ids = (await models(job.query)).map((m) => m.id);
      for (const id of job.want) ok(ids.includes(id), `${job.what}: ${id}${ids.includes(id) ? '' : ' is no longer on OpenRouter; choose another (see --models) and pass it to the scripts'}`);
      if (args.has('models') && !job.quiet) console.log(`     ${ids.length} ${job.what} models: ${ids.join(', ')}`);
    } catch (e) {
      ok(false, `could not list ${job.what} models: ${e.message}`);
    }
  }
}

console.log(bad ? `\n${bad} thing${bad > 1 ? 's' : ''} to fix before making a voice.` : '\nReady.');
process.exitCode = bad ? 1 : 0;
