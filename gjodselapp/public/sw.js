// Service worker: offline-cache av app-shell.
// Alle stier bygges relativt til registreringens scope, slik at
// samme fil fungerer både på rot (localhost) og understi (GitHub Pages).
// Graph-/innloggingskall (annet origin) røres aldri.
const CACHE = 'gjodsel-shell-v4';
const SCOPE = self.registration.scope; // f.eks. https://…/honseri/
const shellUrl = (p) => new URL(p, SCOPE).toString();
// egg.html vidaresender til egg/ – hønseri-appen (eggregistrering) med eigen service worker
const SHELL = ['', 'logg', 'skifter', 'innstillinger', 'egg.html', 'manifest.json', 'icon-192.png', 'icon-512.png'].map(shellUrl);
const EGG_PREFIX = new URL('egg/', SCOPE).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Egg-appen har sin eigen service worker – ikkje rør noko under egg/
  if (url.pathname.startsWith(EGG_PREFIX)) return;

  if (req.mode === 'navigate') {
    // Sider: nettverk først, cache som offline-fallback
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match(shellUrl(''))))
    );
    return;
  }

  // Statiske ressurser: cache først
  event.respondWith(
    caches.match(req).then(
      (m) =>
        m ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
