// Bump this on every deploy that changes a precached asset (below) — anyone
// whose browser installed an older CACHE name keeps serving its contents until
// the name changes (this is exactly what happened once: portal.css changed on
// the server, but v1 installs never saw it).
const CACHE = 'sng-public-v3';

// Static assets only. '/' deliberately does NOT belong here: precaching the
// customer home page meant every later visit was served the HTML captured at
// install time, so a deploy never reached anyone who had opened the site once.
// Navigations go network-first below instead.
const ASSETS = ['/css/portal.css', '/images/sng-logo-nav.png', '/favicon/favicon-32x32.png'];

// Cache each asset on its own rather than via cache.addAll, which rejects as a
// unit — one renamed or 404ing file used to abort the whole install, leaving
// the worker permanently unregistered instead of merely missing one file.
self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE)
    .then(cache => Promise.all(
      ASSETS.map(url => cache.add(url).catch(() => {/* asset moved or absent — skip it */}))
    ))
    .then(() => self.skipWaiting())
));

// Activate a new version immediately instead of waiting for every open tab to
// close first — an asset fix should reach an already-open tab, not sit blocked
// behind "waiting to activate" indefinitely.
self.addEventListener('activate', event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== location.origin) return;

  // Pages: always ask the network first, so a logged-in state, a fresh deploy,
  // or a redirect between the staff and member hosts is never masked by a cached
  // copy. Falling back to the cache only when the network genuinely fails is
  // what makes the app usable offline without freezing it in the past.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then(hit => hit || offlinePage()))
    );
    return;
  }

  // Static assets: cache-first is fine, they are versioned by CACHE name.
  //
  // The fallback chain must never end in a rejected promise: respondWith on a
  // rejection is what surfaces as a bare ERR_FAILED in the browser, which reads
  // as "this site is down" even when only one request failed.
  event.respondWith(
    caches.match(request)
      .then(hit => hit || fetch(request))
      .catch(() => caches.match(request).then(hit => hit || Response.error()))
  );
});

/** Shown only when the network is unreachable AND the page was never cached. */
function offlinePage() {
  return new Response(
    `<!doctype html><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>SNG Express</title>
     <div style="font-family:system-ui,sans-serif;text-align:center;padding:3rem 1.5rem;color:#1c2b3a">
       <h1 style="font-size:1.25rem">ບໍ່ສາມາດເຊື່ອມຕໍ່ອິນເຕີເນັດໄດ້</h1>
       <p style="color:#5b6572">ກະລຸນາກວດສອບອິນເຕີເນັດ ແລ້ວລອງໃໝ່ອີກຄັ້ງ</p>
       <p style="color:#5b6572">เชื่อมต่ออินเทอร์เน็ตไม่ได้ กรุณาลองใหม่อีกครั้ง</p>
     </div>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
