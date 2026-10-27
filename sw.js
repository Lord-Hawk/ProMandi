/* ProMandi service worker: keeps the app files so the app opens without internet. Bump CACHE when you upload new files. */
const CACHE = 'promandi-v23';
const FILES = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'js/config.js', 'js/util.js', 'js/model.js', 'js/ui.js', 'js/app.js', 'js/pdf-lib.min.js',
               'icons/icon-192.png', 'icons/icon-512.png', 'icons/logo-bar.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.headers.has('range') || /\.(mp4|webm)$/.test(new URL(req.url).pathname)) return;     // the start-up video: straight from the network / browser cache       // the API calls go straight to Google
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })   // newest file when online
      .catch(() => caches.match(req).then(r => r || caches.match('index.html')))                                  // cached file when offline
  );
});
