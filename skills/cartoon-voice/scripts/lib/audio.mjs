// Sound handling shared by the voice tools: decoding and encoding (through
// ffmpeg), tidying a take, and measuring how high a voice is.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';

const run = promisify(execFile);

/** Sample rate everything is worked on at. */
export const RATE = 44100;

export const AUDIO_FILE = /\.(wav|m4a|mp3|ogg|opus|aac|flac)$/i;

let scratchDir, scratchCount = 0;
/** A path for a temporary file; the folder is removed when the process ends. */
export function scratch(name = 'tmp') {
  if (!scratchDir) {
    scratchDir = mkdtempSync(join(tmpdir(), 'cartoon-voice-'));
    process.on('exit', () => rmSync(scratchDir, { recursive: true, force: true }));
  }
  return join(scratchDir, `${++scratchCount}-${name}`);
}

/** Mono 16-bit WAV file bytes from float samples. */
export function wavBytes(samples, rate = RATE) {
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

/** Any audio file as mono floats at `rate`. */
export async function decodeFile(path, rate = RATE, raw = []) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', ...raw, '-i', path, '-f', 'f32le', '-ac', '1', '-ar', String(rate), 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 28 });
  return new Float32Array(stdout.buffer, stdout.byteOffset, stdout.length >> 2).slice();
}

/** Whatever a speech model sent back (mp3, or raw 16-bit samples) as mono floats at `rate`. */
export async function decode({ audio, type = '' }, rate = RATE) {
  const file = scratch('take.src');
  writeFileSync(file, audio);
  const raw = /pcm|l16/i.test(type) ? ['-f', 's16le', '-ar', type.match(/rate=(\d+)/)?.[1] || '24000', '-ac', '1'] : [];
  try {
    return await decodeFile(file, rate, raw);
  } finally {
    rmSync(file, { force: true });
  }
}

const CODEC = {
  '.m4a': ['-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart'],
  '.mp3': ['-c:a', 'libmp3lame', '-b:a', '96k'],
  '.ogg': ['-c:a', 'libvorbis', '-q:a', '4'],
  '.opus': ['-c:a', 'libopus', '-b:a', '48k'],
  '.wav': ['-c:a', 'pcm_s16le'],
};
export const FORMATS = Object.keys(CODEC).map((e) => e.slice(1));

/** Write samples as an audio file; the format follows the file name (.m4a .mp3 .ogg .opus .wav). */
export async function encode(samples, path, rate = RATE, outRate = rate) {
  const codec = CODEC[extname(path).toLowerCase()];
  if (!codec) throw new Error(`cannot write ${extname(path) || 'a file with no extension'}: use one of ${FORMATS.join(', ')}`);
  const wav = scratch('encode.wav');
  writeFileSync(wav, wavBytes(samples, rate));
  try {
    // Opus only works at 48 kHz and a few lower rates, so it picks its own
    const rateArgs = extname(path).toLowerCase() === '.opus' ? [] : ['-ar', String(outRate)];
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, ...rateArgs, '-ac', '1', ...codec, path]);
  } finally {
    rmSync(wav, { force: true });
  }
}

/** Trim silence from both ends, even out loudness, add tiny fades. */
export function polish(samples, rate = RATE) {
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

/**
 * How high a voice is, by autocorrelation over 30 ms frames (120 to 800 Hz).
 * @returns {{median: number, low: number, high: number, range: number, frames: number}}
 *   median pitch in Hz (0 if too little of the clip is voiced to say), its 10th
 *   and 90th percentiles, and the distance between those in semitones: how
 *   sing-song the delivery is
 */
export function pitch(full, fullRate = RATE) {
  // about 22 kHz is plenty for a voice, and several times quicker
  const step = Math.max(1, Math.round(fullRate / 22050));
  const s = new Float32Array(Math.floor(full.length / step));
  for (let i = 0; i < s.length; i++) {
    let v = 0;
    for (let k = 0; k < step; k++) v += full[i * step + k];
    s[i] = v / step;
  }
  const rate = fullRate / step;
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
  if (found.length < 5) return { median: 0, low: 0, high: 0, range: 0, frames: found.length };
  found.sort((a, b) => a - b);
  const at = (p) => found[Math.min(found.length - 1, Math.floor(found.length * p))];
  return { median: at(0.5), low: at(0.1), high: at(0.9), range: 12 * Math.log2(at(0.9) / at(0.1)), frames: found.length };
}

/** Several clips as one, with a short pause between them: 24 kHz mono WAV bytes, small enough to send to a judge. */
export async function joined(paths, pause = 0.45, rate = 24000) {
  const parts = [];
  const gap = new Float32Array(Math.floor(rate * pause));
  for (const p of paths) parts.push(await decodeFile(p, rate), gap);
  parts.pop();
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return wavBytes(all, rate);
}
