// Scripted play-through: drives the real app with real pointer events in
// headless Chrome and saves a film strip of screenshots.
//
//   node tools/play.mjs --out strip.jpg --steps "tap@nose; wait 1200; shot; swipe@belly up; wait 600; shot"
//
// Steps (separated by ';'):
//   tap@<anchor>            tap an anchor on Lumi (nose, belly, headTop, handL, footL, tailTip, earTipL, star ...)
//   tap <x> <y>             tap at a viewport fraction (0..1)
//   swipe@<anchor> <dir>    quick swipe from an anchor (up/down/left/right)
//   stroke@<anchor> <ms>    rub back and forth over an anchor
//   hold@<anchor> <ms>      press and hold
//   wait <ms>               wait
//   shot [label]            add a frame to the strip
//   tapbubble | tapsnack | tapbutterfly   tap a prop wherever it currently is
//   eval <js>               run a JavaScript expression in the page (logs the result; no ';' inside)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true';
}
const PORT = 8137;
const W = Number(args.w || 380), H = Number(args.h || 480);
const COLS = Number(args.cols || 6);
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const up = async () => { try { return (await fetch(`http://localhost:${PORT}/index.html`, { method: 'HEAD' })).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url)), String(PORT)], { stdio: 'ignore' });
  for (let i = 0; i < 40 && !(await up()); i++) await sleep(100);
}
const launchArgs = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', `--window-size=${W},${H}`];
if (args['fake-mic']) launchArgs.push('--use-fake-device-for-media-stream');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: launchArgs });
let failed = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => { failed = true; console.log('[pageerror]', e.message, e.stack || ''); });
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/404|favicon/.test(t)) { failed = true; console.log('[console.error]', t); }
    else if (t.startsWith('[lumi]')) console.log(t);
  });
  await page.goto(`http://localhost:${PORT}${args.url || '/?q=medium&hour=13'}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__lumiReady === true', { timeout: 15000 });
  await sleep(Number(args.settle || 1200));
  const at = async (anchor) => page.evaluate((a) => window.__lumi.screenOf(a), anchor);
  const shots = [];
  for (const raw of (args.steps || '').split(';').map((s) => s.trim()).filter(Boolean)) {
    const [head, ...rest] = raw.split(/\s+/);
    const [cmd, anchor] = head.split('@');
    if (cmd === 'wait') await sleep(Number(rest[0]));
    else if (cmd === 'shot') shots.push({ label: rest.join(' ') || `#${shots.length + 1}`, data: await page.screenshot({ type: 'jpeg', quality: 86, encoding: 'base64' }) });
    else if (cmd === 'eval') console.log('[eval]', JSON.stringify(await page.evaluate(`(async () => { return ${rest.join(' ')}; })()`)));
    else if (cmd === 'tapbubble' || cmd === 'tapsnack' || cmd === 'tapbutterfly') {
      const p = await page.evaluate((c) => {
        const L = window.__lumi;
        const w = c === 'tapbubble' ? L.bubbles.items.find((b) => b.age > 0.3)?.pos : c === 'tapsnack' ? L.snack.pos : L.butterfly.pos;
        return w ? L.screenOf([w.x, w.y, w.z]) : null;
      }, cmd);
      if (!p) { console.log(`[play] nothing to ${cmd}`); continue; }
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await sleep(50);
      await page.mouse.up();
    } else if (cmd === 'tap') {
      const p = anchor ? await at(anchor) : { x: Number(rest[0]) * W, y: Number(rest[1]) * H };
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await sleep(60);
      await page.mouse.up();
    } else if (cmd === 'hold') {
      const p = await at(anchor);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await sleep(Number(rest[0] || 900));
      await page.mouse.up();
    } else if (cmd === 'swipe') {
      const p = anchor ? await at(anchor) : { x: Number(rest[1]) * W, y: Number(rest[2]) * H };
      const dir = rest[0];
      const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) { await page.mouse.move(p.x + d[0] * i * 22, p.y + d[1] * i * 22); await sleep(16); }
      await page.mouse.up();
    } else if (cmd === 'stroke') {
      const p = await at(anchor);
      const ms = Number(rest[0] || 1500);
      await page.mouse.move(p.x - 30, p.y);
      await page.mouse.down();
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const k = Math.sin((Date.now() - t0) / 160);
        await page.mouse.move(p.x + k * 34, p.y + Math.cos((Date.now() - t0) / 230) * 8);
        await sleep(24);
      }
      await page.mouse.up();
    } else console.log('unknown step', raw);
  }
  if (args.out && shots.length) {
    const cols = Math.min(COLS, shots.length), rows = Math.ceil(shots.length / cols);
    const sheet = await browser.newPage();
    await sheet.setViewport({ width: W * cols, height: H * rows, deviceScaleFactor: 1 });
    await sheet.setContent(`<body style="margin:0;background:#222"><canvas id="c" width="${W * cols}" height="${H * rows}"></canvas></body>`);
    const dataUrl = await sheet.evaluate(async (shots, W, H, cols) => {
      const ctx = document.getElementById('c').getContext('2d');
      for (let i = 0; i < shots.length; i++) {
        const img = new Image();
        img.src = 'data:image/jpeg;base64,' + shots[i].data;
        await img.decode();
        const x = (i % cols) * W, y = Math.floor(i / cols) * H;
        ctx.drawImage(img, x, y);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x, y, W, 20);
        ctx.fillStyle = '#fff';
        ctx.font = '13px sans-serif';
        ctx.fillText(shots[i].label, x + 6, y + 14);
      }
      return document.getElementById('c').toDataURL('image/jpeg', 0.88);
    }, shots, W, H, cols);
    writeFileSync(args.out, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`[play] saved ${args.out} (${shots.length} frames)`);
  }
} finally {
  await browser.close();
  server?.kill();
}
process.exit(failed ? 1 : 0);
