/* Service worker for Hønseri (Cloudflare-versjonen).
   - App-skalet: nettverk først, så du alltid får nyaste versjon når du er på nett.
     Kopien i cache blir brukt når telefonen er utan dekning.
   - API-kall (/api/) og innlogging (/cdn-cgi/) går alltid rett til nettet.
     Registreringar utan nett blir lagra i ei kø i appen og sende seinare.
   - Berre vellukka svar frå eiga adresse blir lagra. Ei omdirigering til
     innloggingssida skal aldri lagrast som om ho var appen.
   - Tek imot push-varsel og viser dei. */
const CACHE = 'honseri-cf-v2';
const ASSETS = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(ASSETS.map((a) => cache.add(a).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const cacheable = (resp) => resp && resp.ok && resp.type === 'basic';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn-cgi/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (cacheable(resp)) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put('/', copy));
          }
          return resp;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((resp) => {
        if (cacheable(resp)) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      }),
    ),
  );
});

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = {}; }
  event.waitUntil(
    self.registration.showNotification(d.title || 'Hønseri 🥚', {
      body: d.body || 'Egg er ikkje registrert i dag enno.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: d.tag || 'egg-reminder',
      data: { url: d.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow('/');
    }),
  );
});
