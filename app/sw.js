// Offline support. After one visit with a connection, Lumi works without one.
//   - big, rarely-changing files (character, voice audio, 3D library): cache first
//   - the app's own code, page and small lists (which languages exist, which
//     lines each has): network first, falling back to the cache
// Voice audio is requested with its build id (?v=...), so re-rendered lines are
// picked up on their own. If you rebuild assets/lumi.bin, bump CACHE below.
const CACHE = 'lumi-v2';
const CORE = ['./', 'index.html', 'src/style.css', 'src/main.js', 'manifest.webmanifest', 'assets/lumi.bin', 'assets/voice/languages.json',
  'vendor/three/three.module.js', 'vendor/three/three.core.js', 'icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const heavy = /\/(assets|vendor|icons)\//.test(url.pathname) && !url.pathname.endsWith('.json');
  event.respondWith(heavy ? cacheFirst(req) : networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
