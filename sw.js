// Tiger Trade Follow-up — service worker
//  1. caches the app shell so it opens instantly / offline (data always comes fresh from the API)
//  2. receives push "pings" from the Apps Script backend, fetches this person's new
//     notifications from the API and shows them
const CACHE = 'pmf-v3';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'pmf-config').map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // API + fonts: straight to network
  // network first, cache fallback — so updates show up right away
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});

// ── push ─────────────────────────────────────────────────────────────
async function readConfig() {
  try { const r = await (await caches.open('pmf-config')).match('config'); return r ? await r.json() : null; }
  catch (e) { return null; }
}

const ICON = 'icon-192.png';

async function onPush() {
  const cfg = await readConfig();
  let items = [];
  if (cfg && cfg.api) {
    try {
      const q = new URLSearchParams({ action: 'inbox', pin: cfg.pin, name: cfg.name, deviceId: cfg.deviceId });
      const j = await (await fetch(cfg.api + '?' + q.toString())).json();
      if (j.ok) items = j.items || [];
    } catch (e) {}
  }
  // A push must always show something (browsers require it).
  if (!items.length) {
    return self.registration.showNotification('TT Follow-up', {
      body: 'There are new project updates — tap to open.', icon: ICON, badge: ICON, tag: 'pmf-generic', data: { hash: '#feed' }
    });
  }
  const show = items.length > 3 ? items.slice(0, 2) : items;
  for (const it of show) {
    await self.registration.showNotification(it.title, {
      body: it.body, icon: ICON, badge: ICON, tag: 'pmf-' + it.ts,
      data: { hash: it.taskId ? '#task=' + encodeURIComponent(it.projectId) + '/' + encodeURIComponent(it.taskId) : '#feed' }
    });
  }
  if (items.length > 3) {
    await self.registration.showNotification('+' + (items.length - 2) + ' more updates', {
      body: 'Tap to see all changes.', icon: ICON, badge: ICON, tag: 'pmf-more', data: { hash: '#feed' }
    });
  }
}

self.addEventListener('push', e => e.waitUntil(onPush()));

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.hash) || '';
  const url = self.registration.scope + hash;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) {
        await c.focus();
        c.postMessage(hash === '#feed' ? { type: 'open-feed' } : { type: 'open', hash });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
