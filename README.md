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

## Phone and tablet apps (Android and iOS)

`mobile/` is a **Kotlin Multiplatform** project that turns Lumi into real
Android and iOS apps. Both carry the whole web app inside them, so they work
offline from the very first launch and never touch the internet (the Android
app doesn't even have the internet permission). The only permission either asks
for is the microphone, for "say it back".

```
mobile/
  shared/        Kotlin shared by both apps
    commonMain/    how the bundled web app is served, navigation and microphone
                   rules, and the bridge between the page and the device
    androidMain/   LumiActivity: the Android host (WebView)
    iosMain/       LumiViewController: the iOS host (WKWebView), compiled to Shared.framework
  androidApp/    the Android app: icons, theme, signing; MainActivity is one line
  iosApp/        the iOS app: iosApp.xcodeproj, a few lines of Swift, icon, Info.plist
```

The web files are copied in from `app/` on every build, so changes to Lumi only
need a rebuild. Both apps run full screen, don't let a stray swipe or the back
button take a child out of the app, keep the screen awake while Lumi is up, and
release the microphone and pause sound whenever they leave the screen.

### Android

```sh
npm run build:apk        # → dist/baby-lumi.apk (signed, ready to install)
```

Android 7.0 or newer with an up-to-date "Android System WebView". Copy the APK
to the device and open it (Android asks once to allow installs from that app),
or with the device on USB: `adb install dist/baby-lumi.apk`. Raise
`versionCode` in `mobile/androidApp/build.gradle.kts` for each release you hand
out, so it installs as an update.

For Google Play, build an app bundle instead with
`cd mobile && ./gradlew :androidApp:bundleRelease` (Play also asks you to enroll
in Play App Signing, using this key as the upload key).

### iOS (iPhone and iPad)

Open `mobile/iosApp/iosApp.xcodeproj` in Xcode and press Run. The first build
compiles the shared Kotlin (a few minutes); later builds are quick. iOS 16.4 or
newer.

- **Simulator:** works as is (`npm run build:ios` builds it from the command line).
- **Your own iPhone or iPad:** select the *iosApp* target → *Signing &
  Capabilities* → choose your **Team** (a free Apple ID works for your own
  devices; installs made that way expire after 7 days). Plug the device in, pick
  it as the run destination, and press Run.
- **App Store / TestFlight:** needs a paid Apple Developer account, then
  *Product → Archive*.

### Tests

```sh
npm run test:mobile      # shared Kotlin tests, on the Android side and in the iOS simulator
```

In development builds, the page can be inspected with Chrome's
`chrome://inspect` (Android) or Safari's Develop menu (iOS); release builds
don't allow this. Both apps log what the page reports (secure context, WebGL 2,
microphone support, any script errors) to Logcat / the Xcode console under
"Lumi".

### The Android signing key (keep it safe)

The APK is signed with `mobile/keystore/lumi-release.jks`; its password is in
`mobile/keystore.properties`. Both are deliberately left out of git.

**Back both files up somewhere private.** Android only accepts an update if it
is signed with the same key as the installed app: without this key, a new
version can't be installed over the old one (it has to be uninstalled first,
which loses Lumi's settings), and you can't publish updates on Google Play.

- Key alias `lumi`, RSA 4096, valid until 2054
- Certificate SHA-256:
  `63:CE:67:0C:28:8C:66:37:77:7B:15:35:2D:CE:59:5C:26:7B:3C:7C:A7:DB:EB:10:EB:19:C7:CB:51:4A:1F:81`

(iOS apps are signed by Xcode with your Apple account instead; there is no key
file to keep for them.)

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
mobile/             Android and iOS apps (Kotlin Multiplatform)
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
