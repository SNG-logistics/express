// Bump this on every deploy that changes a precached asset (below) — a
// cache-first fetch strategy means anyone whose browser already installed
// an old CACHE name is stuck serving stale assets forever otherwise (this
// is exactly what happened: portal.css changed on the server, but v1
// installs never saw it, since caches.match() never re-checks the network).
const CACHE = 'sng-public-v2';
const ASSETS = ['/','/css/portal.css','/images/sng-logo-nav.png','/favicon/favicon-32x32.png'];
// Activate a new version immediately instead of waiting for every open tab
// to close first — an asset fix should reach an already-open tab, not sit
// blocked behind "waiting to activate" indefinitely.
self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
});
