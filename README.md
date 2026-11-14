# Lumi

A gentle talking companion for little ones (made with a three-year-old in mind).

Lumi is a small, fluffy creature who lives on a hilltop meadow. She wakes up when
touched, giggles when tickled, repeats what she hears in a squeaky voice, asks
for snacks, plays peekaboo, counts, sings, and falls asleep when the day is done.

The screen shows **only Lumi and her meadow**. There are no menus, buttons, ads,
accounts or links. Everything is done by touching her, touching her world, or
talking to her.

## Run it

```sh
npm start            # then open http://localhost:8137
```

That is all: the app in `app/` is plain files with no build step and no runtime
dependencies. (`npm install` is only needed for the developer tools and tests.)

It needs a reasonably modern browser with WebGL 2: Safari 15+ / iOS 15+, Chrome,
Edge or Firefox.

## How to play

| Do this | Lumi does this |
| --- | --- |
| Tap her while she sleeps | She wakes up, stretches and says hello |
| Tap her nose | "Boop!" Three quick boops make her sneeze |
| Tap her tummy | Tickles and belly laughs |
| Tap an ear, a paw, a foot, her tail, a cheek | Each has its own reaction, and she names the body part |
| Tap an eye | Peekaboo |
| Tap the star on her forehead | Sparkles |
| Stroke her | She closes her eyes, coos, and hearts float up |
| Press and hold (or lay a whole hand on her) | A big hug and "I love you!" |
| Swipe up on her | She jumps |
| Swipe sideways on her | She spins; three spins and she gets dizzy |
| Swipe down on her | She sits down (again to stand up) |
| Talk to her | She listens, then says it back in her own voice |
| Tap the sky | Bubbles by day (she names each colour as it pops), shooting stars by night |
| Tap the grass | A flower grows; every so often a butterfly comes out |
| Swipe across the sky | A puff of wind |
| Tap or drag the snack to her mouth | She eats it and says thank you |

Left to herself Lumi looks around, stretches, hums, and every half-minute or so
suggests a tiny game: *"Can you find my nose?"*, counting, animal sounds,
peekaboo, bubbles, a dance or a song. If nobody plays she calls for company,
then takes a nap. The meadow follows the real time of day, and at night she is
sleepy and goes back to bed on her own.

### For grown-ups

Press and hold the **top-right corner for two seconds** to open the settings:
language, volume, voice copying (microphone) on/off, nature sounds, time of day
(clock / always day / night), graphics quality, and a **Bedtime now** button
that tucks Lumi in.

### Languages

Lumi speaks **English, 中文, Español, Français, Deutsch, 日本語, 한국어 and
Português**. She starts in the device's language when it is one of these
(English otherwise); pick another in the grown-ups' panel and she says hello in
it straight away. Everything she says changes: greetings, body parts, numbers,
colours, food, animal sounds and peekaboo each use what children actually say in
that language ("いない いない、ばあ！", "Cadê? Achou!", "汪汪汪！"). The panel
itself is translated too. Only the chosen language's audio is downloaded.

**Privacy:** nothing leaves the device. There are no network requests other than
loading the app's own files, and nothing is tracked. Microphone sound is held in
memory just long enough to play your child's words back, and is never saved or
sent anywhere.

## Putting Lumi on a tablet or phone

Lumi is an installable web app (PWA). Once installed she opens full-screen from
the home screen and works offline.

1. **Host the `app/` folder on any static https host** (GitHub Pages, Netlify,
   Cloudflare Pages, your own server ...). It is just static files.
2. Open that address on the device, then *Share → Add to Home Screen* (iOS) or
   *Install app* (Android / desktop Chrome).

To try it on your home network without hosting anything, run `npm run
start:https` and open the printed `https://192.168.x.x:8443` address on the
device. The certificate is self-signed, so the browser asks you to confirm it
once. (Plain `http` works too, but browsers only allow the microphone on https
pages, so Lumi will not be able to copy voices.)

Tip: on iPad, *Guided Access* (Settings → Accessibility) keeps little hands
inside the app.

## How it is built

No art assets were drawn or downloaded: everything is generated.

- **Lumi's body** is sculpted in code from blended signed-distance shapes
  (`tools/character/design.mjs`), meshed, and baked with skin weights, colour
  masks and ambient occlusion into `app/assets/lumi.bin`
  (`npm run build:character`).
- **Fur** is real-time shell fur: the skinned mesh is drawn in up to 30 layers
  with procedurally placed strands. **Eyes, eyelids, mouth, blush and brows**
  are drawn procedurally in shaders so they animate smoothly and stay sharp.
- **Animation** is a layered system (`app/src/anim/`): procedural idle
  (breathing, sway, tail wag, ear twitches), stances, about fifty keyframed
  action clips, look-at, lip-sync, blinking, and spring physics on ears and tail.
- **The meadow** (`app/src/world/`) has instanced, wind-blown grass and flowers,
  layered hills, a sky that follows the clock, fireflies at night, and an HDR
  pipeline with soft shadows, depth of field, bloom and tone mapping. Quality
  adapts to the device automatically.
- **Voice**: spoken lines are rendered ahead of time, in eight languages, with
  the macOS speech engine and pitched up (`npm run build:voice`).
  Giggles, yawns, coos and singing come from a small formant synthesizer in the
  browser, as do all sound effects, so there are no other audio files.
- **Behaviour** lives in `app/src/brain/brain.js` as small generator scripts.

```
app/                the app itself (static files; deploy this folder)
  index.html, sw.js, manifest.webmanifest, icons/
  assets/           lumi.bin (character), voice/<language>/ (spoken lines)
  vendor/three/     three.js, vendored
  src/
    engine/         renderer, post-processing, camera, quality tiers
    world/          sky, terrain, grass, particles, time of day
    character/      mesh loader, fur and eye shaders
    anim/           channels, clips, animator, spring physics
    audio/          engine, voice lines, vocal synth, sound effects, microphone
    brain/          behaviour and saved settings
    props/          snacks, bubbles, butterfly, flowers
    fx/, input/, ui/
tools/              asset builders and developer tools
tests/              unit and behaviour tests
```

### Changing Lumi's voice or words

Her lines live in `tools/voice/<language>.mjs` (one file per language, all with
the same groups). After editing, re-render with `npm run build:voice` (macOS
with `ffmpeg`), or just one language with `npm run build:voice -- --lang fr`.
Options: `--voice NAME --pitch 1.28 --rate 90 --tempo 0.95 --only <group>`.

**Adding a language:**

1. Copy `tools/voice/en.mjs` to `tools/voice/<code>.mjs` and translate it. Keep
   every group; use what small children really say rather than literal
   translations.
2. Add it to `tools/voice/index.mjs` with a macOS voice (`say -v '?'` lists the
   installed ones) and a pitch factor. The build prints the pitch each language
   ends up at; aim for roughly 220-290 Hz so she sounds like the same creature.
3. Add the grown-ups' panel text to `app/src/ui/strings.js`.
4. Run `npm run build:voice -- --lang <code>` and `npm test` (the tests check
   that every language is complete).

### Developer tools

```sh
npm test                 # unit + behaviour tests (no browser needed)
npm run smoke            # plays with the real app in headless Chrome
npm run perf             # frame time per quality tier
node tools/shot.mjs  --url "/?awake=1&hour=18.6" --out shot.png
node tools/sheet.mjs --clips wave,jump,giggle --out sheet.jpg   # pose contact sheets
node tools/play.mjs  --out strip.jpg --steps "tap@nose; wait 800; shot"
```

Handy URL parameters while developing: `?hour=22` (time of day), `?q=low|medium|high|ultra`,
`?awake=1` (skip the sleepy start), `?clip=wave&t=0.5` (freeze a pose),
`?stance=sit`, `?expr=joy`, `?view=face`, `?lang=ja`, `?nomic`.
