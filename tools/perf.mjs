// Measures how long a full frame takes to render at each quality tier
// (including a GPU sync, so the numbers reflect real cost).
//   node tools/perf.mjs
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url)), '8139'], { stdio: 'ignore' });
await sleep(600);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--window-size=1280,800'] });
try {
  for (const q of ['ultra', 'high', 'medium', 'low']) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
    await page.goto(`http://localhost:8139/?q=${q}&hour=13&awake=1`, { waitUntil: 'load' });
    await page.waitForFunction('window.__lumiReady === true');
    await sleep(1500);
    const r = await page.evaluate(async () => {
      const L = window.__lumi, gl = L.engine.renderer.getContext();
      // time whole frames including a GPU sync, so the number reflects real rendering cost
      const times = [];
      const px = new Uint8Array(4);
      for (let i = 0; i < 60; i++) {
        const t0 = performance.now();
        L.animator.update(1 / 60);
        L.engine.render(L.scene, i / 60);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // forces the GPU to actually finish the frame
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      return { q: L.engine.tier.name, size: L.engine.width + 'x' + L.engine.height, shells: L.lumi.shellCount, medianMs: +times[30].toFixed(2), p90Ms: +times[54].toFixed(2) };
    });
    console.log(JSON.stringify(r));
    await page.close();
  }
} finally { await browser.close(); server.kill(); }
