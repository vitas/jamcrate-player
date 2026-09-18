// App-shell cache, versioned. Bumped by hand per prototype build.
const V = 'jcplayer-p0-20';
const SHELL = ['.', 'index.html', 'app.js', 'model.js', 'zipimport.js', 'storage.js', 'app.css', 'manifest.webmanifest', 'icons/favicon.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || url.pathname.endsWith('/fixtures/')) return; // user files never touch the cache
  e.respondWith(
    caches.match(e.request).then(hit => hit || (e.request.mode === 'navigate' ? caches.match('index.html') : null) || fetch(e.request))
  );
});
