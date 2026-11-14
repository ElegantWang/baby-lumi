// Screenshot / smoke-test helper: loads the app in headless Chrome (GPU accelerated)
// and saves a PNG.
//
//   node tools/shot.mjs --out /path/x.png [--url "/?debug=1"] [--w 900] [--h 1200]
//        [--dpr 1] [--wait 1500] [--eval "js to run in page"] [--after 500]
//        [--clip x,y,w,h] [--fake-mic]
//
// Exits non-zero if the page logged an error.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true';
    args[k] = v;
  }
}

const PORT = Number(args.port || 8137);
const W = Number(args.w || 900);
const H = Number(args.h || 1200);
const DPR = Number(args.dpr || 1);
const WAIT = Number(args.wait || 1500);
const URL_PATH = args.url || '/';
const OUT = args.out;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function serverUp() {
  try {
    const r = await fetch(`http://localhost:${PORT}/index.html`, { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}

let serverProc = null;
if (!(await serverUp())) {
  serverProc = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url)), String(PORT)], {
    stdio: 'ignore',
  });
  for (let i = 0; i < 40 && !(await serverUp()); i++) await sleep(100);
}

const launchArgs = [
  '--use-angle=metal',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--hide-scrollbars',
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream',
  `--window-size=${W},${H}`,
];
if (args['fake-mic']) launchArgs.push('--use-fake-device-for-media-stream');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: launchArgs });
let failed = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR, hasTouch: args.touch === 'true' });
  const logs = [];
  page.on('console', (m) => {
    const t = m.type();
    const text = m.text();
    if (t === 'error') {
      failed = true;
      logs.push(`[console.error] ${text}`);
    } else if (t === 'warn' || t === 'warning') {
      logs.push(`[warn] ${text}`);
    } else if (args.verbose || text.startsWith('[lumi]')) {
      logs.push(`[log] ${text}`);
    }
  });
  page.on('pageerror', (e) => {
    failed = true;
    logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`);
  });
  page.on('requestfailed', (r) => {
    failed = true;
    logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) {
      failed = true;
      logs.push(`[http ${r.status()}] ${r.url()}`);
    }
  });

  await page.goto(`http://localhost:${PORT}${URL_PATH}`, { waitUntil: 'load' });
  // Wait for the app to say it is ready (or time out and screenshot anyway).
  try {
    await page.waitForFunction('window.__lumiReady === true', { timeout: Number(args.timeout || 15000) });
  } catch {
    logs.push('[shot] timed out waiting for window.__lumiReady');
    failed = true;
  }
  await sleep(WAIT);
  if (args.eval) {
    const r = await page.evaluate(`(async () => { ${args.eval} })()`);
    if (r !== undefined) console.log('[eval]', typeof r === 'string' ? r : JSON.stringify(r));
    await sleep(Number(args.after || 400));
  }
  if (OUT) {
    const opts = { path: OUT, type: 'png' };
    if (args.clip) {
      const [x, y, width, height] = args.clip.split(',').map(Number);
      opts.clip = { x, y, width, height };
    }
    await page.screenshot(opts);
    console.log(`[shot] saved ${OUT}`);
  }
  for (const l of logs) console.log(l);
} finally {
  await browser.close();
  if (serverProc) serverProc.kill();
}
process.exit(failed ? 1 : 0);
