// The few OpenRouter calls the voice tools need: speech, transcription, and a
// short text answer. The key comes from OPENROUTER_API_KEY, or from a .env
// file at the top of the project (which git ignores).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const API = 'https://openrouter.ai/api/v1';

export function apiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  const env = fileURLToPath(new URL('../../.env', import.meta.url));
  const found = existsSync(env) && readFileSync(env, 'utf8').match(/^\s*OPENROUTER_API_KEY\s*=\s*["']?([^\s"']+)/m);
  if (found) return found[1];
  throw new Error('no OpenRouter key: set OPENROUTER_API_KEY, or put OPENROUTER_API_KEY=... in a .env file at the top of the project');
}

/** POST with patience: busy or flaky answers are tried again, real refusals are not. */
async function post(path, body, { tries = 5, timeout = 90000 } = {}) {
  let problem = '';
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(Math.min(20000, 1000 * 2 ** i));
    try {
      const res = await fetch(API + path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
 * @param {{model: string, input: string, instructions?: string, voice?: string,
 *          reference?: {audio: Buffer, text: string}}} o
 * @returns {Promise<{audio: Buffer, type: string}>} compressed (mp3) or raw (pcm) audio, and its content type
 */
export async function speech({ model, input, instructions, voice, reference }) {
  const body = { model, input, response_format: 'mp3' };
  if (instructions) body.instructions = instructions;
  if (voice) body.voice = voice;
  if (reference) {
    body.input_references = [
      { type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,' + reference.audio.toString('base64') } },
      { type: 'text', text: reference.text },
    ];
  }
  const res = await post('/audio/speech', body);
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length < 200) throw new Error('OpenRouter /audio/speech: empty audio');
  return { audio, type: res.headers.get('content-type') || 'audio/mpeg' };
}

/** Speech to text: what a listener who does not know the line would write down. */
export async function transcribe(wav, language, model) {
  const res = await post('/audio/transcriptions', { model, language, input_audio: { data: wav.toString('base64'), format: 'wav' } }, { timeout: 45000 });
  return String((await res.json()).text ?? '').trim();
}

/** One short answer from a text model. */
export async function ask(prompt, model = 'anthropic/claude-haiku-5.5') {
  const res = await post('/chat/completions', { model, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 400 }, { timeout: 45000 });
  return String((await res.json()).choices?.[0]?.message?.content ?? '').trim();
}
