const CACHE = 'hq-shell-v4';

const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});

async function cacheShell() {
  const cache = await caches.open(CACHE);
  await Promise.all(SHELL.map((path) => putFresh(cache, path)));
}

async function putFresh(cache, path) {
  const response = await fetch(path, { cache: 'reload' });
  if (!response.ok) throw new Error(`Shell asset failed: ${path}`);
  const stored = new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  await cache.put(path, stored);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      try {
        const stored = new Response(await response.clone().blob(), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
        await cache.put(request, stored);
      } catch {
        /* Some responses cannot be stored. The network result is still returned. */
      }
    }
    return response;
  } catch (error) {
    const cached = (await caches.match(request)) || (request.mode === 'navigate' ? await caches.match('./index.html') : null);
    if (cached) return cached;
    throw error;
  }
}
