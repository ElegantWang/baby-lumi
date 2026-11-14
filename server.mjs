// Tiny zero-dependency static server for the app/ folder.
//   node server.mjs [port] [--https]
//
// --https serves over TLS with a self-signed certificate (created on first use
// with openssl). Phones and tablets only allow the microphone on https pages,
// so use it to try Lumi's "say it back" on another device on your network.
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { createReadStream, statSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(fileURLToPath(new URL('./app', import.meta.url)));
const HTTPS = process.argv.includes('--https');
const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || (HTTPS ? 8443 : 8137));

function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
  }
  return out;
}

function selfSignedCert() {
  const dir = fileURLToPath(new URL('./.cert', import.meta.url));
  const key = join(dir, 'key.pem'), cert = join(dir, 'cert.pem');
  if (!existsSync(key) || !existsSync(cert)) {
    mkdirSync(dir, { recursive: true });
    const names = ['DNS:localhost', 'IP:127.0.0.1', ...lanAddresses().map((ip) => `IP:${ip}`)].join(',');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-keyout', key, '-out', cert,
      '-subj', '/CN=Lumi (local)', '-addext', `subjectAltName=${names}`], { stdio: 'ignore' });
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bin': 'application/octet-stream',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.glsl': 'text/plain; charset=utf-8',
};

function resolvePath(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const full = normalize(join(ROOT, p));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null; // no path traversal
  return full;
}

const handler = (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let file = resolvePath(req.url || '/');
  if (!file) {
    res.writeHead(400).end('bad path');
    return;
  }
  let st;
  try {
    st = statSync(file);
    if (st.isDirectory()) {
      file = join(file, 'index.html');
      st = statSync(file);
    }
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': st.size,
    'cache-control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
};

const server = HTTPS ? https.createServer(selfSignedCert(), handler) : http.createServer(handler);
server.listen(PORT, () => {
  const scheme = HTTPS ? 'https' : 'http';
  console.log(`\n  Lumi is running:\n`);
  console.log(`    on this computer   ${scheme}://localhost:${PORT}/`);
  for (const ip of lanAddresses()) console.log(`    on your network    ${scheme}://${ip}:${PORT}/`);
  if (HTTPS) console.log('\n  The certificate is self-signed: your browser will ask you to confirm it once.');
  else console.log('\n  Tip: phones and tablets need https for the microphone. Try: npm run start:https');
  console.log('');
});
