---
name: cartoon-voice
description: Give a character a cute, cartoonish voice and record spoken lines in it, in any language, with OpenRouter text-to-speech. The voice is invented from a written description (not a real person), stays the same character across hundreds of lines, and every take is checked and re-recorded automatically. Use this whenever the user wants a cute, cartoon, kid-friendly or character voice; says a voice sounds robotic, flat or too grown-up; wants voice lines, voice-over, narration or TTS audio for an app, game, toy or story character; wants more lines or another language added to a voice made this way; or wants new voices to choose from, even if they never say "TTS".
---

# Cartoon voice

Makes a character's voice and records lines in it. The scripts in `scripts/` do the work; this page says how to use them well, and what was learned making the first voice with them (Lumi, a talking companion for a three-year-old, November 2026: 1,168 lines in 8 languages plus giggles and yawns).

## How it works, and why

1. **The voice is invented from a description.** A ready-made preset voice sounds cute on excited lines and slides back into an ordinary adult on soft ones. A voice the model makes up from "the voice of a small fluffy baby animal in an animated preschool series…" is a character all the way through.
2. **One short recording is the character.** The model invents a different voice on every call, so you keep one recording you like and have the model imitate it for every line (voice cloning, of a voice that never belonged to anyone). That is what keeps line 1 and line 900 the same creature.
3. **Every take is checked.** A speech model is an actor, not a tape recorder: it fluffs words, squeals on short shouts, drifts out of character. The recorder transcribes each take, measures its pitch against the voice's own, re-records failures, and lists what it could not get clean.

**You cannot hear.** Everything you know about how a voice sounds comes from pitch measurements, transcriptions, and other models listening for you. Those are good enough to shortlist and to catch mistakes; they are not ears. So always leave the user an easy way to listen (step 6), and say plainly in your report that quality was judged by models.

## Before you start

Run the scripts with `node` from the user's project folder, by their path inside this skill (below, `S` stands for this skill's `scripts/` folder). They need Node 18+, `ffmpeg`, and an OpenRouter key. Every script prints its options with `--help`.

```
node S/check-setup.mjs
```

This checks all three, shows what the key has spent, warns if the file holding the key is not git-ignored, and confirms the models the scripts use by default are still on OpenRouter. Fix anything marked `FIX` first. Model ids come and go: if one is gone, `--models` lists the alternatives, and `references/notes.md` says what to look for in a replacement.

- **The key** is read from `OPENROUTER_API_KEY`, or from a `.env` file in the working folder or any folder above it. If there is none, ask the user for one. It belongs only in a git-ignored `.env`: never in a script, a saved command, or a tracked file.
- **Is there a voice already?** Look for a voice file and its recording (`voice.json` and a `.wav`, or the project's own equivalent, perhaps with its own build command). If the character has a voice, keep it: record new lines through the existing recording so they match, and use the project's own tooling where it exists. Redesign only if the user asks for a different voice.
- **A finished voice comes with this skill:** `assets/lumi-voice/` holds the voice made for Lumi, which the person it was made for has listened to and accepted, with recordings of its own for Spanish, French and German and a ready `voice.json`. If the user asks for "the Lumi voice" or "the same voice as last time", copy that folder into the project and go to step 4. For a new character, design a new voice, so that two characters do not sound alike.
- **Find out, from the project or the user:** who the character is and who listens (age matters: toddlers need slower and clearer), which languages, what the lines are, and where the audio goes (folder, file format, how the app finds a line).

Use invented voices. If the user wants the voice of a real person, or of a character from an existing show, that needs that person's consent or the rights: say so rather than cloning it.

## 1. Design candidates

```
node S/design-voice.mjs --count 8 --out voice-candidates \
  --describe "The voice of a small fluffy baby animal in an animated preschool series: high, soft and round, giggly and gentle, each word clear and unhurried." \
  --say "Hi! I'm Pip! I love playing with you. Can you find my tail? Yay, you found it! Now I'm a little bit sleepy. Good night, sweet dreams."
```

- **Describe a character in a show, not acoustics.** Who it is, what kind of programme it is in, a few words for the sound, and how it speaks ("each word clear and unhurried" matters for small children). The description above is the one behind the Lumi voice; adapt it to the character.
- **The script** is what every candidate says, and later the words that go with the recording. Make it five or six short sentences, about 25 words, in the moods the lines will need (a greeting with the character's name, a question, a cheer, something sleepy), so the recording shows the voice happy, curious and soft. A little longer does no harm.
- **Make plenty.** Candidates from one description differ more than candidates from different descriptions (the same words gave voices from 400 to 480 Hz), so eight from one good description beats two each from four. Running it again adds more without overwriting. It takes seconds.
- Add `voice-candidates*/` to `.gitignore`. Keep the folders until the user has listened and settled on a voice: they are how the user compares.

## 2. Choose one

```
node S/judge.mjs voice-candidates/*.wav --brief "a little dragon who tells bedtime stories to four-year-olds"
```

Three audio models rate each candidate blind. `--brief` tells them who the voice is for (the default is a cuddly character for ages 2 to 4). **This is slow:** about half a minute per answer, so eight candidates take around four minutes, with progress on stderr. Run it in the background or with a long timeout. It costs about two cents per voice judged.

What to look for:

- **What they say it sounds like.** "Cartoon animal character", "young child" and "voice actor doing a cartoon character" are all passes; the last is simply how cartoon voices are made. The failures are an adult speaking normally ("woman reading aloud", "narrator") and "synthetic assistant", whatever the numbers.
- **Not shrill.** A piercing voice is the commonest way a cute voice goes wrong. Prefer `shrill` near 2, and treat 4 and up as a warning.
- **Pitch.** The Lumi recording sits near 400 Hz. Recordings much above 450 Hz produced lines the judges found shrill.
- **Ties.** One judge is noise, and scores within a point of each other are a tie. Break ties in this order: lower `shrill`; pitch nearer 400 Hz; a remark that two judges both make.

Then make it easy for the user to listen: `node S/listen-page.mjs voice-candidates` writes a page with every candidate on it. Unless the user asked to pick the voice themselves first, do not stop here: take the best candidate, carry on, and tell them at the end which others are worth a listen. Changing the voice later costs one file copy and a re-record.

## 3. Save the voice

Copy the chosen `.wav` into the project (say `voice/pip.wav`) and write `voice/voice.json` beside it.

```json
{
  "name": "Pip",
  "model": "fish-audio/drama-3",
  "description": "The voice of a small fluffy baby animal in an animated preschool series: ...",
  "audience": "a bedtime story app for four-year-olds",
  "references": {
    "default": { "file": "pip.wav", "text": "Hi! I'm Pip! I love playing with you. ..." }
  },
  "moods": { "happy": "cheerful and bubbly", "sleepy": "sleepy and soft", "asking": "curious and playful" },
  "defaultMood": "happy"
}
```

- `text` must be exactly what is said in the recording (it is in `candidates.json`). The model uses the pair to learn the voice; the wrong words make every line worse.
- `moods` are directions as you would give an actor, a few words each. Lines name a mood; the recording supplies the voice. `assets/lumi-voice/voice.json` has a fuller set.
- That is everything needed. The optional `softer`, `spread` and `soundSpread` seen in the Lumi file tune the checks and have good defaults (`references/notes.md`, "How a take is checked").
- The recording and `voice.json` are the character: tell the user to commit them. A line is re-recorded when its text, its mood's wording, the model, or the recording it is modelled on changes, and not otherwise.

## 4. Write the lines

One JSON file, languages at the top, one entry per line. The id becomes the file name.

```json
{
  "_moods": { "sleepy": ["night"], "asking": ["find"] },
  "en": {
    "hello_1": "Hi there! I'm Pip!",
    "find_tail": "Can you find my tail?",
    "night_1": "Good night, sweet dreams.",
    "story_1": { "text": "Once upon a time, a little dragon found a shiny red ball.", "mood": "happy" }
  },
  "fr": { "hello_1": "Coucou ! Je m'appelle Pip !" }
}
```

- A line is a string, or `{ "text", "mood" | "direction", "sound", "longest" }`.
- `_moods` sets the mood of lines by id, in every language, so translations stay plain `id: text`. An entry matches the id itself or the id followed by `_`: `"night"` covers `night` and `night_2`; `"p1"` does not cover `p10`. Other lines get `defaultMood`.
- Keep lines short and speakable. Write numbers as words. Exclamation marks raise the pitch, so use them where the character really is excited and not on every line.
- If the lines already live in the project (a strings file, a story script), do not copy them by hand: write a small script in the project that turns that source into this JSON, with the mood of each line in it, and run it whenever the source changes. Then the two cannot drift apart.
- `assets/lines.example.json` shows everything, including wordless sounds.

## 5. Record

```
node S/record.mjs --voice voice/voice.json --lines lines.json --out assets/voice --dry-run
node S/record.mjs --voice voice/voice.json --lines lines.json --out assets/voice --lang en
node S/judge.mjs assets/voice/en
```

The dry run lists what would be recorded and which mood each line falls in; check that before spending anything. **Then start small:** one language (or a dozen lines with `--only`), and judge the folder. A folder is judged as one voice, from a sample of its clips. `consistent` should be 8 or more and "sounds like" should still be the character; this is the test preset voices failed. If it passes, record the rest by dropping `--lang`.

It writes `<out>/<language>/<id>.m4a` and a `manifest.json` per language, and only records what is new or changed, so run it as often as you like. `--only hello` redoes one line or group, `--lang fr,de` limits languages, `--force` redoes everything, `--format mp3` (or ogg, opus, wav) changes the file type, `--report takes.json` saves every line's pitch, takes and what was heard. About 150 lines take a few minutes and cost about a tenth of a cent each.

The summary gives the middle pitch of the lines against the recording's. Excited lines come out above their recording and gentle or sleepy ones below, so a set of bedtime lines sitting three semitones low is normal. At the end it lists what did not come out clean:

- `LISTEN` means the transcribers heard other words, or the take ran far too long. `note` means nearly right, or the pitch strayed more than 5.5 semitones from the recording (above: a squeal; below: a grown-up).
- Transcribers mishear small cartoon voices, most of all one-word lines and animal noises, so a flag is a reason to look, not proof. Re-record flagged lines once or twice (`--only <id>`).
- If the **same** wrong word comes back each time, the model really is saying it that way: reword the line (German "köstlich" never came out right and became "schmeckt gut"; French "Chante avec moi" kept coming out as "Chantez" and became "Tu chantes avec moi ?"). If it is heard **differently** each time, it is probably fine: put it on the list for the user's ears.
- If judges say the soft lines sound grown-up, name those lines to the user. Things to try, neither of which Lumi needed: a recording a little higher, or a smaller `spread` in `voice.json` so that low takes are recorded again.
- Never quietly drop a flagged line from your report.

### Other languages

A cloned voice keeps the accent of its recording. From an English recording, Chinese, Japanese, Korean and Portuguese were judged native, while Spanish, French and German came out with an American accent, and their own recordings fixed it.

- **Spanish, French, German, and languages close to them:** make a recording for the language straight away. It costs a few cents and was better every time.
- **Any other language:** record a few lines and ask, for example `node S/judge.mjs assets/voice/ja --lang Japanese`. If `native` averages under about 8, or two judges name a foreign accent however slight, give it a recording of its own.

```
node S/design-voice.mjs --count 6 --out voice-candidates-fr --describe "<the same description>" \
  --say "Coucou ! Je m'appelle Pip ! J'adore jouer avec toi. ..."
node S/judge.mjs voice-candidates-fr/*.wav --lang French
node S/listen-page.mjs voice-candidates-fr
```

Translate the script naturally, as a native writer for children would. Choose, in this order: judged native with no accent named; pitch closest to the main recording (within a few semitones, so it is still the same character); then score. Add it to `references` under the language code (`"fr": { "file": "pip.fr.wav", "text": "..." }`) and record: only that language is redone. If the character's name is mispronounced in a language, spell it the way that language would (French read "Lumi" best as "Loumi").

### Wordless sounds

Giggles, "wheee!", yawns and kisses record well as lines marked `"sound": true`, each with its own `direction` and a `longest` length in seconds. Their words are not checked, and they are allowed to go higher than speech. Put them under a language key of their own such as `"sounds"`, since they are the same in every language. Spellings that worked are in `assets/lines.example.json`. Longer performances (singing, snoring, crying) were not tried.

## 6. Review and hand over

- `node S/judge.mjs <old folder> <new folder>` compares two sets blind if you are replacing a voice.
- `node S/listen-page.mjs assets/voice --out listen.html` writes a page with every line and its text, click to play. `--out` keeps it outside the folder that ships; add it to `.gitignore`, and open it for the user if they are there (`open listen.html` on macOS).
- If the app caches audio, add the manifest's `build` id to the audio URLs (`hello_1.m4a?v=<build>`); it changes whenever anything is re-recorded.
- `node S/check-setup.mjs --spend` before and after gives the cost. For a short script most of it is designing and judging, not recording: a trial with twelve candidates, five rounds of judging and twelve lines cost $0.26. The figure is everything spent on the key in that time.
- Tell the user: which voice you chose and why, what the judges said in a line or two, every line still flagged, what it cost, where to listen and which other candidates are worth hearing, which files are the character and should be committed, and that all of it was judged by models, so their ears have the last word. If they dislike the voice, another candidate is one file copy and a re-record away.

## More

`references/notes.md` has the detail: what was tried and rejected, the numbers behind the advice above, how a take is checked, choosing replacement models, the OpenRouter requests the scripts make, and a table of problems and fixes. Read it when something misbehaves or before changing a script.
