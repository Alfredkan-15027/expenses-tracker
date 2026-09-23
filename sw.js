// Offline support. Only same-origin app files are cached; the app never talks to other servers.
// Strategy: stale-while-revalidate — open instantly from cache, refresh files in the background,
// so design updates (styles / icons) reach the phone on the next launch even without a version bump.

const VERSION = 'v1.1.0';
const CACHE = `expenses-tracker-${VERSION}`;

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'styles/tokens.css',
  'styles/base.css',
  'styles/components.css',
  'styles/screens.css',
  'assets/icons/sprite.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon.png',
  'src/main.js',
  'src/core/analysis.js',
  'src/core/backup.js',
  'src/core/benchmarks.js',
  'src/core/categories.js',
  'src/core/crypto.js',
  'src/core/dates.js',
  'src/core/ids.js',
  'src/core/invest.js',
  'src/core/money.js',
  'src/core/recurring.js',
  'src/core/settings.js',
  'src/data/cloudbackup.js',
  'src/data/db.js',
  'src/data/demo.js',
  'src/data/gdrive.js',
  'src/data/lock.js',
  'src/data/store.js',
  'src/ui/charts.js',
  'src/ui/haptics.js',
  'src/ui/html.js',
  'src/ui/overlays.js',
  'src/ui/screens/history.js',
  'src/ui/screens/insights.js',
  'src/ui/screens/invest.js',
  'src/ui/screens/settings.js',
  'src/ui/screens/shared.js',
  'src/ui/screens/today.js',
  'src/ui/sheets/backup.js',
  'src/ui/sheets/categories.js',
  'src/ui/sheets/cloud.js',
  'src/ui/sheets/entry.js',
  'src/ui/sheets/guides.js',
  'src/ui/sheets/invest.js',
  'src/ui/sheets/lockscreen.js',
  'src/ui/sheets/onboarding.js',
  'src/ui/sheets/plan.js',
  'src/ui/sheets/recurring.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('expenses-tracker-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(event, 'index.html', () => fetch('index.html', { cache: 'no-cache' })));
    return;
  }
  event.respondWith(staleWhileRevalidate(event, req, () => fetch(req, { cache: 'no-cache' })));
});

async function staleWhileRevalidate(event, key, load) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key, { ignoreSearch: true });
  const network = load()
    .then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const res = await network;
  return res || new Response('离线中，且这个文件还没有缓存。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
