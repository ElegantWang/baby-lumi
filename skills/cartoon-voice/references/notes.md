# Notes behind the cartoon-voice skill

What was tried, measured and learned making the first voice (Lumi, November 2026). Numbers called "judged" are averages of audio models' opinions on a 1 to 10 scale, not measurements; pitches are measured.

Contents: [What was tried](#what-was-tried) · [Numbers](#numbers) · [If a model is gone](#if-a-model-is-gone) · [The requests](#the-requests) · [How a take is checked](#how-a-take-is-checked) · [Problems and fixes](#problems-and-fixes)

## What was tried

| Approach | What happened |
| --- | --- |
| macOS `say`, pitched up (the voice being replaced) | Judged cute 5.7 to 7.3, robotic 4.0 to 5.7. The user called it robotic. |
| Preset voices (ElevenLabs v4 "matilda", Gemini 3.8 Flash TTS) with style directions | Cute on excited lines; on soft and sleepy lines they slid into an ordinary adult voice, so the character came and went. |
| ByteDance Seed Audio with a reference recording | Too slow and unreliable to build with (frequent 502s). |
| **Fish Audio `drama-3`: a voice invented from a description, then cloned for every line** | The character held across moods and languages. This is what the scripts do. |

Why the last one works: with no reference, drama-3 treats `instructions` as a description of who is speaking and makes a voice up. With a reference recording (audio plus its exact words), it speaks in that voice and treats `instructions` as direction for the line. So one generated clip becomes the character.

## Numbers

- **Result, judged blind, old voice against new, per language:** cute 5.7–7.3 → 9.0–9.3; cartoonish 4.3–7.3 → 8.3–9.0; robotic 4.0–5.7 → 1.3–2.3. After Spanish, French and German got recordings of their own: French cute 9.0 and robotic 2.0; Spanish and German cute 8.0, robotic 3.3–3.7.
- **Pitch.** The Lumi English recording has a median near 400 Hz; her lines, mostly cheerful, have a median of 430 to 460 Hz (German, from a 330 Hz recording, about 370 Hz). Mood moves it both ways: in a later trial, a bedtime story's gentle and sleepy lines sat at 320 Hz from a 387 Hz recording, about three semitones below, with no line flagged and the judges still hearing the character. A Spanish recording whose lines came out at a median of 501 Hz was judged shrill 5.0; swapping to one whose lines sit at 441 Hz brought that to 3.7.
- **Squeals.** One-word shouts ("Six!", "Boop!") often come out at 700 to 800 Hz. The spectrum confirmed the pitch tracker was right, not doubling. Hence the softer retake.
- **Candidates vary.** Four descriptions, four candidates each: all four descriptions averaged cute 8.2 to 9.0 and shrill 2.2 to 2.4, while candidates of a single description ranged over about 80 Hz. The draw matters more than the wording, once the wording is reasonable.
- **Accent.** From an English recording: Chinese, Japanese, Korean and Portuguese judged native; Spanish, French and German judged 6.3 to 6.7 out of 10 with "American accent". With their own recordings the judges heard neutral Latin American Spanish, Metropolitan French and Standard German. In a later trial with another voice, French from the English recording was judged native 9.3, but two of three judges heard a slight English inflection and `consistent` was 7.3; with a French recording it was native 10, no accent named, `consistent` 8.7.
- **Cost.** One take costs about $0.0004. A full recording of 1,196 lines with checks and retakes cost about $1. Judging costs about two cents per voice judged (three models each). The whole Lumi exploration, auditions and dead ends included, cost under $7. A small job from scratch (12 candidates, five rounds of judging, 12 lines in two languages) cost $0.26, nearly all of it designing and judging.
- **Time.** Designing takes seconds. Recording runs eight lines at once; about 150 lines take a few minutes. Audio judges take 20 to 60 seconds per answer, three at a time: six candidates took three minutes.

## If a model is gone

`node scripts/check-setup.mjs --models` lists what OpenRouter has. Every script takes a flag for another model (`--model` on design-voice, `--judges` on judge; in `voice.json`: `model`, `listeners`, `comparer`).

- **Speech model.** It must do two things: invent a voice from a text description with no preset voice named, and imitate a reference recording passed as `input_references`. Models that only offer preset voices will not hold the character. Test a replacement the way step 5 of SKILL.md says: a dozen lines across moods, then judge the folder for `consistent` and "sounds like". A new model means a new voice: design again.
- **Transcribers (`listeners`).** Two different ones, tried in order; the first to hear the line right settles it. Several were tried; `google/gemini-3.5-transcribe` and `openai/whisper-large-v3` coped best with a small high voice. All of them mishear animal noises.
- **Comparer.** Any quick, cheap text model.
- **Judges.** Chat models that accept audio input. Use three from different makers so one model's taste does not decide.

## The requests

All under `https://openrouter.ai/api/v1`, with `Authorization: Bearer <key>`. `scripts/lib/openrouter.mjs` is the working code.

```
POST /audio/speech            → audio bytes (content-type says mp3 or pcm)
  { "model": "fish-audio/drama-3", "input": "<the line>", "response_format": "mp3",
    "instructions": "<voice description, or direction for the line>",
    "input_references": [
      { "type": "input_audio", "input_audio": { "data": "data:audio/wav;base64,<reference wav>" } },
      { "type": "text", "text": "<exactly what the reference says>" } ] }

POST /audio/transcriptions    → { "text": "..." }
  { "model": "openai/whisper-large-v3", "language": "fr", "input_audio": { "data": "<base64 wav>", "format": "wav" } }

POST /chat/completions        (a judge: a text part plus an audio part)
  { "model": "google/gemini-4-carbon", "messages": [ { "role": "user", "content": [
      { "type": "text", "text": "<what to judge, reply as JSON>" },
      { "type": "input_audio", "input_audio": { "data": "<base64 wav>", "format": "wav" } } ] } ] }

GET /models?output_modalities=speech            speech models
GET /models?output_modalities=transcription     transcribers
GET /models?input_modalities=audio&output_modalities=text   models that can listen
GET /key                                        { data: { usage, limit, limit_remaining } }
```

The reference recording is a 24 kHz mono 16-bit WAV of 10 to 15 seconds (about 700 KB). 4xx answers are not retried (a bad request or no credit); 408, 429 and 5xx are, with growing pauses.

## How a take is checked

In `scripts/record.mjs`, for each take:

1. Trim silence, even out loudness, add short fades.
2. **Length.** Shorter than a quarter of a second, or longer than the line could reasonably take (`longest`, by default about three times an unhurried reading), means the model wandered off the script.
3. **Pitch.** The take's median pitch against the reference recording's. Beyond `spread` semitones (5.5; 8.5 for sounds) it is out of voice: above, a squeal; below, a grown-up.
4. **Words.** A transcriber writes down what it hears. If that is not the line letter for letter, a text model decides: SAME, CLOSE (a slip a recogniser makes on short playful speech) or DIFFERENT. A second transcriber gets a go if the first did not hear it right.
5. Up to four takes; the best is kept. After a squeal, later takes are directed "sweet, friendly and calm" with exclamation marks removed. Two takes both judged CLOSE end it early, since a third will not change a recogniser's mind about "Red!" versus "Read."

A line's fingerprint (model, reference recording, its words, direction, text) is stored in the manifest, which is how unchanged lines are skipped.

Optional settings in `voice.json`, all with defaults that suited Lumi:

| Setting | Default | What it does |
| --- | --- | --- |
| `spread` | 5.5 | Semitones a spoken take may sit from its recording before it counts as out of voice. |
| `soundSpread` | 8.5 | The same for lines marked `"sound": true`, which may go higher. |
| `softer` | "sweet, friendly and calm" | The direction used for the retake after a squeal. |
| `listeners` | two transcribers | Models that write down what a take says, tried in order. |
| `comparer` | a small text model | Decides SAME, CLOSE or DIFFERENT. |
| `audience` | "a children's app" | Told to the comparer, so it knows what kind of line to expect. |

## Problems and fixes

| Problem | Fix |
| --- | --- |
| The voice sounds like an adult on quiet lines | If it is most lines: you are probably on a preset voice, or the reference is not being used. Check `references` in `voice.json` and that `text` matches the recording. If it is one judge's remark about a sleepy line or two: name the lines to the user. Untested things to try: a slightly higher recording, or a smaller `spread` so low takes are redone (`--report` shows each line's pitch). |
| Lines are shrill | Choose a lower recording (see Pitch above), and use fewer exclamation marks. |
| A foreign accent in one language | Give that language its own recording (SKILL.md, "Other languages"). |
| The same line is flagged every time with the same wrong word | The model mispronounces it. Reword the line, or respell the word the way it sounds. |
| A line is flagged with a different mishearing each time | Usually the transcriber. Leave it for the user's ears. |
| One-word lines keep squealing | The softer retake handles most. Otherwise write them less excitedly ("Six." or "Number six!"). |
| A sound runs too long or comes out as an adult sigh | Try another spelling and a shorter `longest`. "Tee hee hee!" ran long where "Hee hee!" did not; "Aaah." read as a sigh where "Aaaah, hmm." read as a yawn. |
| Judges time out or return nothing | They are slow. One clip per request (the script does this), three requests at a time, and shorter clips (`--sample 6`). |
| The app plays old audio after a re-record | Cached files. Put the manifest's `build` id in the audio URL. |
| Everything re-records when nothing changed | The reference recording or its `text` changed, or `model`, or a mood's wording. Each is part of every line's fingerprint. |
