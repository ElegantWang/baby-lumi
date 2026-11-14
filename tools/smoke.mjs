// End-to-end smoke test: runs the real app in headless Chrome (GPU on, fake
// microphone), plays with Lumi the way a child would, and checks that
// everything responds and nothing errors.
//
//   node tools/smoke.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 8141;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 820, H = 1100;
const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url)), String(PORT)], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/index.html`, { method: 'HEAD' })).ok) break;
  } catch {
    await sleep(100);
  }
}

const results = [];
const problems = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  (' + detail + ')' : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--window-size=${W},${H}`],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1, hasTouch: true });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console.error: ' + m.text());
  });
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`);
  });
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const at = (anchor) => ev((a) => window.__lumi.screenOf(a), anchor);
  const tap = async (p) => {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await sleep(50);
    await page.mouse.up();
  };

  await page.goto(`http://localhost:${PORT}/?q=medium&sw=1`, { waitUntil: 'load' });
  await page.waitForFunction('window.__lumiReady === true', { timeout: 20000 });
  await ev(() => window.__lumi.store.set('time', 'day')); // same daylight whatever time the test runs
  await sleep(1800);

  // ---- the home screen shows Lumi and nothing else -------------------------------
  const ui = await ev(() => {
    const visible = [...document.body.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
    });
    return {
      visible: visible.map((el) => el.id || el.className || el.tagName),
      buttons: document.querySelectorAll('button:not(#lumi-panel button), a, nav, menu, [role=menu], [role=button]').length,
      text: document.body.innerText.trim(),
    };
  });
  check('home screen has no buttons, links or menus', ui.buttons === 0, `${ui.buttons} found`);
  check('home screen shows no text', ui.text === '', JSON.stringify(ui.text.slice(0, 40)));
  check('only the stage (and the invisible grown-ups corner) are on screen', ui.visible.every((v) => ['stage', 'lumi-hot'].includes(v)), ui.visible.join(','));

  check('starts asleep', (await ev(() => window.__lumi.brain.mode)) === 'asleep');
  await tap({ x: W / 2, y: H * 0.6 });
  await sleep(600);
  check('first touch wakes her', (await ev(() => window.__lumi.brain.mode)) === 'awake');
  check('audio is running after the first touch', (await ev(() => window.__lumi.audio.ctx?.state)) === 'running');
  await sleep(6500);
  const lines = await ev(() => ({ loaded: window.__lumi.voice.raw.size, total: Object.keys(window.__lumi.voice.manifest.lines).length, decoded: window.__lumi.voice.buffers.size }));
  check('all voice lines are downloaded', lines.loaded === lines.total && lines.total >= 140, `${lines.loaded}/${lines.total}`);
  check('she spoke her greeting', lines.decoded >= 1, `${lines.decoded} decoded`);
  check('microphone is listening', (await ev(() => window.__lumi.mimic.state)) === 'listening');
  // the fake microphone beeps, so stop it from interrupting the rest of the test
  await ev(() => window.__lumi.store.set('mimic', false));

  // ---- touching her ---------------------------------------------------------------
  const reactions = [['nose', 'boop'], ['belly', 'tickle'], ['tailTip', 'tailSurprise'], ['footL', 'footTickleL'], ['handR', 'highFiveR'], ['earTipL', 'earFlickL']];
  for (const [anchor, clip] of reactions) {
    await ev(() => window.__lumi.animator.stopAll());
    await sleep(2300);
    await tap(await at(anchor));
    await sleep(250);
    const playing = await ev((c) => window.__lumi.animator.isPlaying(c), clip);
    check(`touching ${anchor} plays "${clip}"`, playing);
  }
  await sleep(2500);

  // lip-sync: say a line and watch her mouth
  const mouth = await ev(async () => {
    const L = window.__lumi;
    L.brain.speak('hello_1', { gesture: false });
    let max = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      await new Promise((r) => requestAnimationFrame(r));
      max = Math.max(max, L.lumi.face.mouthOpen);
    }
    return max;
  });
  check('her mouth moves when she speaks', mouth > 0.25, `peak opening ${mouth.toFixed(2)}`);
  await sleep(1200);

  // ---- touching her world ----------------------------------------------------------
  await tap({ x: W * 0.2, y: H * 0.1 });
  await sleep(1300);
  const bubblesBefore = await ev(() => window.__lumi.bubbles.count);
  check('tapping the sky makes bubbles', bubblesBefore >= 3, `${bubblesBefore} bubbles`);
  const b = await ev(() => {
    const L = window.__lumi;
    const all = L.bubbles.items.map((x) => ({ age: x.age, ...L.screenOf([x.pos.x, x.pos.y, x.pos.z]) }));
    window.__bubblesOnScreen = all.every((s) => s.x > 0 && s.x < innerWidth && s.y > 0 && s.y < innerHeight);
    return all.find((s) => s.age > 0.3) || null;
  });
  check('every bubble is on screen where little fingers can reach it', await ev(() => window.__bubblesOnScreen));
  if (b) await tap(b);
  await sleep(200);
  check('tapping a bubble pops it', (await ev(() => window.__lumi.bubbles.count)) === bubblesBefore - 1);
  await ev(() => window.__lumi.bubbles.clear());
  await sleep(600);
  await tap({ x: W * 0.2, y: H * 0.86 });
  await sleep(400);
  check('tapping the grass grows a flower', (await ev(() => window.__lumi.blooms.items.length)) === 1);

  // ---- gestures ---------------------------------------------------------------------
  await sleep(1200);
  let p = await at('belly');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(p.x, p.y - i * 24);
    await sleep(16);
  }
  await page.mouse.up();
  await sleep(450);
  const airborne = await ev(() => window.__lumi.lumi.bones.root.position.y);
  check('a swipe up makes her jump', airborne > 0.1, `height ${airborne.toFixed(2)}`);
  await sleep(2200);
  p = await at('belly');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await sleep(900);
  await page.mouse.up();
  await sleep(300);
  check('press and hold gives a hug', await ev(() => window.__lumi.animator.isPlaying('hug')));
  await sleep(3800);

  // ---- feeding ----------------------------------------------------------------------
  await ev(() => window.__lumi.brain.startActivity('hungry'));
  await sleep(4500);
  check('a snack appears when she is hungry', (await ev(() => window.__lumi.snack.state)) === 'waiting');
  const s = await ev(() => {
    const L = window.__lumi;
    return L.screenOf([L.snack.pos.x, L.snack.pos.y, L.snack.pos.z]);
  });
  await tap(s);
  await sleep(700);
  check('tapping the snack feeds her', await ev(() => window.__lumi.animator.isPlaying('eat')));
  await sleep(4500);
  check('she is no longer hungry', (await ev(() => window.__lumi.brain.hunger)) < 0.1);

  // ---- grown-ups' corner ----------------------------------------------------------
  await page.mouse.move(W - 30, 30);
  await page.mouse.down();
  await sleep(700);
  check('a short press on the corner does nothing', !(await ev(() => window.__lumi.panel.isOpen)));
  await sleep(1600);
  await page.mouse.up();
  await sleep(200);
  check('holding the corner for two seconds opens the grown-ups panel', await ev(() => window.__lumi.panel.isOpen));
  // ---- languages ------------------------------------------------------------------
  const langs = await ev(() => [...document.querySelectorAll('#lumi-panel select option')].map((o) => o.value));
  check('the panel offers a choice of languages', langs.length >= 7 && langs[0] === 'auto', langs.join(','));
  check('she starts in the device language', (await ev(() => window.__lumi.voice.lang)) === 'en');
  await page.select('#lumi-panel select', 'zh');
  await sleep(2500);
  const zh = await ev(() => ({
    lang: window.__lumi.voice.lang,
    html: document.documentElement.lang,
    title: document.querySelector('#lumi-panel h2').textContent,
    intro: window.__lumi.voice.text('intro_1'),
    decoded: window.__lumi.voice.buffers.size,
  }));
  check('choosing Chinese switches her voice lines', zh.lang === 'zh' && zh.html === 'zh' && /露米/.test(zh.intro), zh.intro);
  check('the grown-ups panel is shown in that language too', zh.title === '家长设置', zh.title);
  check('she says hello in the new language straight away', zh.decoded >= 1, `${zh.decoded} decoded`);
  await page.click('#lumi-panel .seg[data-key=time] button[data-v=night]');
  await sleep(300);
  check('switching to night changes the world', (await ev(() => window.__lumi.world.env.state.night)) > 0.9);
  await page.click('#lumi-panel [data-act=bedtime]');
  await sleep(300);
  check('panel closes', !(await ev(() => window.__lumi.panel.isOpen)));
  await sleep(18000); // yawn, "good night", sit down, a hummed lullaby, then sleep
  check('"Bedtime now" puts her to sleep', (await ev(() => window.__lumi.brain.mode)) === 'asleep');
  const saved = await ev(() => JSON.parse(localStorage.getItem('lumi.v1')).settings);
  check('settings are remembered', saved.time === 'night' && saved.lang === 'zh', JSON.stringify(saved));

  // ---- performance and offline -------------------------------------------------------
  const fps = await ev(async () => {
    let n = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 2000) {
      await new Promise((r) => requestAnimationFrame(r));
      n++;
    }
    return n / 2;
  });
  check('renders smoothly', fps > 45, `${fps.toFixed(0)} fps`);

  await ev(() => navigator.serviceWorker.ready.then(() => true));
  await sleep(500);
  await page.setOfflineMode(true);
  const before = problems.length;
  await page.reload({ waitUntil: 'load' });
  let offlineOk = true;
  try {
    await page.waitForFunction('window.__lumiReady === true', { timeout: 15000 });
    await tap({ x: W / 2, y: H * 0.6 });
    await sleep(5500);
  } catch {
    offlineOk = false;
  }
  const offline = offlineOk ? await ev(() => ({ lines: window.__lumi.voice.raw.size, lang: window.__lumi.voice.lang })) : { lines: 0 };
  check('works with no network after the first visit, in the chosen language', offlineOk && offline.lines >= 140 && offline.lang === 'zh' && problems.length === before, `${offline.lines} ${offline.lang} voice lines from cache`);
  await page.setOfflineMode(false);

  check('no errors were logged', problems.length === 0, problems.slice(0, 4).join(' | '));
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
