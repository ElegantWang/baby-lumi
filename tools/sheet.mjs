// Contact sheets: renders several moments of animation clips into one image so
// poses can be reviewed at a glance.
//
//   node tools/sheet.mjs --clips wave,jump --frames 6 --out /path/sheet.png
//        [--cell 300x380] [--url "/?q=medium&hour=13"] [--stance sit] [--list]
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
const [CW, CH] = (args.cell || '300x380').split('x').map(Number);
const FRAMES = Number(args.frames || 6);
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const up = async () => { try { return (await fetch(`http://localhost:${PORT}/index.html`, { method: 'HEAD' })).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url)), String(PORT)], { stdio: 'ignore' });
  for (let i = 0; i < 40 && !(await up()); i++) await sleep(100);
}
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio', `--window-size=${CW},${CH}`],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: CW, height: CH, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('[console.error]', m.text()); });
  await page.goto(`http://localhost:${PORT}${args.url || '/?q=medium&hour=13&expr=neutral'}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__lumiReady === true', { timeout: 15000 });
  await sleep(1200);
  if (args.list) {
    console.log(await page.evaluate(() => Object.entries(window.__lumi.animator.clips).map(([n, c]) => `${n}:${c.dur.toFixed(2)}`).join(' ')));
  }
  if (args.stance) await page.evaluate((s) => window.__lumi.animator.setStance(s), args.stance);
  const clips = (args.clips || '').split(',').filter(Boolean);
  const shots = [];
  for (const name of clips) {
    const dur = await page.evaluate((n) => window.__lumi.animator.clips[n]?.dur ?? -1, name);
    if (dur < 0) { console.log(`unknown clip ${name}`); continue; }
    for (let f = 0; f < FRAMES; f++) {
      const t = dur * ((f + 0.5) / FRAMES);
      await page.evaluate((n, tt) => new Promise((res) => {
        window.__lumi.animator.debugPose(n, tt);
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res)));
      }), name, t);
      shots.push({ name, t, data: await page.screenshot({ type: 'jpeg', quality: 88, encoding: 'base64' }) });
    }
  }
  const rows = clips.length;
  const sheet = await browser.newPage();
  await sheet.setViewport({ width: CW * FRAMES, height: CH * rows, deviceScaleFactor: 1 });
  await sheet.setContent(`<body style="margin:0;background:#222"><canvas id="c" width="${CW * FRAMES}" height="${CH * rows}"></canvas></body>`);
  const dataUrl = await sheet.evaluate(async (shots, CW, CH, FRAMES) => {
    const ctx = document.getElementById('c').getContext('2d');
    for (let i = 0; i < shots.length; i++) {
      const img = new Image();
      img.src = 'data:image/jpeg;base64,' + shots[i].data;
      await img.decode();
      const x = (i % FRAMES) * CW, y = Math.floor(i / FRAMES) * CH;
      ctx.drawImage(img, x, y);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x, y, CW, 20);
      ctx.fillStyle = '#fff';
      ctx.font = '13px sans-serif';
      ctx.fillText(`${shots[i].name}  t=${shots[i].t.toFixed(2)}`, x + 6, y + 14);
    }
    return document.getElementById('c').toDataURL('image/jpeg', 0.88);
  }, shots, CW, CH, FRAMES);
  if (args.out) {
    writeFileSync(args.out, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`[sheet] saved ${args.out} (${clips.length} clips x ${FRAMES} frames)`);
  }
} finally {
  await browser.close();
  server?.kill();
}
