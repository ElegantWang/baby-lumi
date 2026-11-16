// The OpenRouter calls the voice tools need: speech, transcription, a short
// text answer, and "listen to this clip and tell me about it".
//
// The key comes from OPENROUTER_API_KEY, or from a .env file in the working
// directory or any directory above it. It is never written anywhere.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const API = 'https://openrouter.ai/api/v1';

// The models that did each job well in November 2026. Model ids come and go, so
// check-setup.mjs looks each of these up and lists what else there is; every
// script also takes a flag to use another.
export const DEFAULTS = {
  // invents a voice from a written description, and imitates a recording of one
  speech: 'fish-audio/drama-3',
  // write down what a take says; these two coped best with a small cartoon voice
  listeners: ['google/gemini-3.5-transcribe', 'openai/whisper-large-v3'],
  // decides whether what a listener wrote down is the line
  comparer: 'anthropic/claude-haiku-5.5',
  // chat models that accept audio, used as blind judges of how a voice sounds
  judges: ['google/gemini-4-carbon', 'thinkingmachines/inkling', 'google/gemini-4-argon'],
};

let key, keyFile = null;
/** The .env file the key was read from, or null if it came from the environment. */
export const keySource = () => (apiKey(), keyFile);

export function apiKey() {
  if (key) return key;
  if (process.env.OPENROUTER_API_KEY) return (key = process.env.OPENROUTER_API_KEY.trim());
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const env = join(dir, '.env');
    const found = existsSync(env) && readFileSync(env, 'utf8').match(/^\s*(?:export\s+)?OPENROUTER_API_KEY\s*=\s*["']?([^\s"']+)/m);
    if (found) {
      keyFile = env;
      return (key = found[1]);
    }
    if (dirname(dir) === dir) break;
  }
  throw new Error('no OpenRouter key: set OPENROUTER_API_KEY, or put OPENROUTER_API_KEY=... in a .env file in the project (and keep that file out of git)');
}

/** A request with patience: busy or flaky answers are tried again, real refusals are not. */
async function call(path, body, { tries = 5, timeout = 90000 } = {}) {
  let problem = '';
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(Math.min(20000, 1000 * 2 ** i));
    try {
      const res = await fetch(API + path, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${apiKey()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
      if (res.ok) return res;
      problem = `${res.status} ${(await res.text()).slice(0, 300)}`;
      if (res.status < 500 && res.status !== 408 && res.status !== 429) break; // our mistake, or no credit: asking again won't help
    } catch (e) {
      problem = e.message;
    }
  }
  throw new Error(`OpenRouter ${path}: ${problem}`);
}

/**
 * Text to speech.
 *
 * With `reference` (a recording and exactly what is said in it) the model
 * speaks in the voice of that recording. Without one, `instructions` is a
 * description of a voice, and the model makes a new voice up on every call.
 * With one, `instructions` is the direction for this line ("sleepy and soft").
 *
 * @param {{model?: string, input: string, instructions?: string, voice?: string,
 *          reference?: {audio: Buffer, text: string}}} o  reference.audio is a WAV file's bytes
 * @returns {Promise<{audio: Buffer, type: string}>} compressed (mp3) or raw (pcm) audio, and its content type
 */
export async function speech({ model = DEFAULTS.speech, input, instructions, voice, reference }) {
  const body = { model, input, response_format: 'mp3' };
  if (instructions) body.instructions = instructions;
  if (voice) body.voice = voice;
  if (reference) {
    body.input_references = [
      { type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,' + reference.audio.toString('base64') } },
      { type: 'text', text: reference.text },
    ];
  }
  const res = await call('/audio/speech', body);
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length < 200) throw new Error('OpenRouter /audio/speech: empty audio');
  return { audio, type: res.headers.get('content-type') || 'audio/mpeg' };
}

/** Speech to text: what a listener who does not know the line would write down. `wav` is a WAV file's bytes. */
export async function transcribe(wav, language, model = DEFAULTS.listeners[0]) {
  const body = { model, input_audio: { data: wav.toString('base64'), format: 'wav' } };
  if (language) body.language = language;
  const res = await call('/audio/transcriptions', body, { timeout: 45000 });
  return String((await res.json()).text ?? '').trim();
}

/** One short answer from a text model. */
export async function ask(prompt, model = DEFAULTS.comparer) {
  const res = await call('/chat/completions', { model, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 400 }, { timeout: 45000 });
  return String((await res.json()).choices?.[0]?.message?.content ?? '').trim();
}

/** Play a clip (a WAV file's bytes) to a chat model that accepts audio, and return what it says about it. */
export async function hear(wav, prompt, model = DEFAULTS.judges[0]) {
  const body = {
    model,
    temperature: 0,
    max_tokens: 2500,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } }] }],
  };
  const res = await call('/chat/completions', body, { tries: 2, timeout: 110000 });
  const json = await res.json();
  if (json.error) throw new Error(`OpenRouter ${model}: ${JSON.stringify(json.error).slice(0, 200)}`);
  return String(json.choices?.[0]?.message?.content ?? '').trim();
}

/** The models OpenRouter has now, e.g. models('output_modalities=speech'). */
export async function models(query = '') {
  const res = await call('/models' + (query ? '?' + query : ''), null, { tries: 3, timeout: 30000 });
  return (await res.json()).data || [];
}

/** What the key has spent and may still spend, in dollars (limit is null when there is none). */
export async function credit() {
  const res = await call('/key', null, { tries: 2, timeout: 20000 });
  const d = (await res.json()).data || {};
  return { label: d.label, usage: d.usage, limit: d.limit ?? null, remaining: d.limit_remaining ?? null };
}
