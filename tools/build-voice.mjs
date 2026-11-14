// Renders Lumi's spoken lines, in every language she speaks, with the macOS
// speech engine. Each line is pitched up so she sounds small and sweet, slowed
// to an unhurried pace, evened out in loudness, and written as compressed audio
// to app/assets/voice/<language>/ together with a manifest.
//
//   node tools/build-voice.mjs                  all languages
//   node tools/build-voice.mjs --lang zh,ja     just these
//   node tools/build-voice.mjs --lang en --only hello       one group
//   overrides: --voice NAME  --pitch 1.28  --rate 90  --tempo 0.95
//
// Requires macOS (`say`) and ffmpeg. Languages and their voices are listed in
// tools/voice/index.mjs; the words are in tools/voice/<code>.mjs.
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LANGUAGES, DEFAULT_LANGUAGE } from './voice/index.mjs';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const ONLY = arg('only', null);
const WANT = arg('lang', null)?.split(',').map((s) => s.trim()).filter(Boolean) || null;
const RATE = Number(arg('rate', 90)); // the speech engine's own pace (it only slows down so far)
const TEMPO = Number(arg('tempo', 0.95)); // final pace relative to the engine's output; < 1 = slower, clearer
const SRC_RATE = 22050;
const OUT_ROOT = fileURLToPath(new URL('../app/assets/voice/', import.meta.url));
const TMP = join(tmpdir(), `lumi-voice-${process.pid}`);
mkdirSync(OUT_ROOT, { recursive: true });
mkdirSync(TMP, { recursive: true });

function readWav(path) {
  const buf = readFileSync(path);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') {
      data = buf.subarray(off + 8, Math.min(buf.length, off + 8 + size));
      break;
    }
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.bits !== 16) throw new Error(`unexpected wav format in ${path}`);
  const n = Math.floor(data.length / 2 / fmt.channels);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2 * fmt.channels) / 32768;
  return { samples: out, rate: fmt.rate };
}

function writeWav(path, samples, rate) {
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
  writeFileSync(path, buf);
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

/** Median speaking pitch (Hz) by autocorrelation: used to report where each voice lands. */
function medianPitch(s, rate) {
  const win = Math.floor(rate * 0.04), hop = Math.floor(rate * 0.02);
  let peak = 0;
  for (const v of s) peak = Math.max(peak, Math.abs(v));
  const lo = Math.floor(rate / 420), hi = Math.floor(rate / 90);
  const found = [];
  for (let st = 0; st + win + hi < s.length; st += hop) {
    let e = 0;
    for (let i = 0; i < win; i++) e += s[st + i] * s[st + i];
    if (Math.sqrt(e / win) < peak * 0.12) continue;
    let best = 0, bestLag = 0;
    for (let lag = lo; lag <= hi; lag++) {
      let c = 0, e2 = 0;
      for (let i = 0; i < win; i++) {
        c += s[st + i] * s[st + i + lag];
        e2 += s[st + i + lag] * s[st + i + lag];
      }
      const r = c / Math.sqrt(e * e2 + 1e-12);
      if (r > best) {
        best = r;
        bestLag = lag;
      }
    }
    if (best > 0.55) found.push(rate / bestLag);
  }
  found.sort((a, b) => a - b);
  return found.length ? found[found.length >> 1] : 0;
}

const installed = execFileSync('say', ['-v', '?'], { encoding: 'utf8' });

async function buildLanguage(lang) {
  const voiceName = arg('voice', lang.voice);
  const pitch = Number(arg('pitch', lang.pitch));
  if (!installed.split('\n').some((l) => l.startsWith(voiceName + ' '))) {
    throw new Error(`the "${voiceName}" voice is not installed (System Settings → Accessibility → Spoken Content → System Voice → Manage Voices)`);
  }
  const outDir = join(OUT_ROOT, lang.code);
  mkdirSync(outDir, { recursive: true });
  const manifestPath = join(outDir, 'manifest.json');
  const manifest = ONLY && existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { lines: {}, groups: {} };
  Object.assign(manifest, { lang: lang.code, name: lang.name, voice: voiceName, pitch, build: Date.now().toString(36) });

  const jobs = [];
  for (const [group, variants] of Object.entries(lang.lines)) {
    if (ONLY && group !== ONLY) continue;
    variants.forEach((text, i) => jobs.push({ group, id: `${group}_${i + 1}`, text }));
  }
  if (ONLY && !jobs.length) throw new Error(`no group "${ONLY}" in ${lang.code}`);

  const pitches = [];
  async function render(job) {
    const raw = join(TMP, `${lang.code}-${job.id}.raw.wav`);
    const fixed = join(TMP, `${lang.code}-${job.id}.wav`);
    await run('say', ['-v', voiceName, '-r', String(RATE), '--data-format=LEI16@' + SRC_RATE, '-o', raw, job.text]);
    const wav = readWav(raw);
    const p = polish(wav.samples, wav.rate);
    if (p.samples.length > wav.rate * 0.5) pitches.push(medianPitch(p.samples, wav.rate) * pitch);
    // Declaring a higher sample rate raises the pitch (same samples, played faster);
    // a time-stretch then gives the words their unhurried pace back.
    const shifted = Math.round(wav.rate * pitch);
    writeWav(fixed, p.samples, shifted);
    const stretch = Math.max(0.5, Math.min(1, TEMPO / pitch));
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', fixed, '-af', `atempo=${stretch.toFixed(4)}`, '-ar', '44100', '-ac', '1',
      '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', join(outDir, `${job.id}.m4a`)]);
    const dur = p.samples.length / shifted / stretch;
    manifest.lines[job.id] = { t: job.text, d: +dur.toFixed(3) };
    return { ...job, dur, rms: p.rms, peak: p.peak };
  }

  const results = [];
  const queue = jobs.slice();
  let failures = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
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
  manifest.groups = {};
  for (const [group, variants] of Object.entries(lang.lines)) {
    manifest.groups[group] = variants.map((_, i) => `${group}_${i + 1}`).filter((id) => manifest.lines[id]);
  }
  const valid = new Set(Object.values(manifest.groups).flat());
  for (const id of Object.keys(manifest.lines)) if (!valid.has(id)) delete manifest.lines[id];
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.m4a') && !valid.has(f.slice(0, -4))) rmSync(join(outDir, f));
  }
  writeFileSync(manifestPath, JSON.stringify(manifest));

  const total = results.reduce((s, r) => s + r.dur, 0);
  const longest = results.slice().sort((a, b) => b.dur - a.dur)[0];
  pitches.sort((a, b) => a - b);
  const hz = pitches.length ? pitches[pitches.length >> 1] : 0;
  console.log(
    `${lang.code}  ${lang.name.padEnd(10)} ${voiceName.padEnd(9)} ${String(results.length).padStart(3)} lines  ${total.toFixed(0).padStart(4)}s  ` +
      `voice ~${hz.toFixed(0)} Hz  longest ${longest ? longest.dur.toFixed(2) + 's' : '-'}  peak ${Math.max(0, ...results.map((r) => r.peak)).toFixed(2)}`,
  );
  return failures;
}

const targets = LANGUAGES.filter((l) => !WANT || WANT.includes(l.code));
if (WANT) for (const code of WANT) if (!LANGUAGES.some((l) => l.code === code)) console.error(`unknown language "${code}"`);
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
