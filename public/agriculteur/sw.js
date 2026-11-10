// Service worker de l'espace agriculteur : l'application s'ouvre même sans réseau (l'écran, pas les données).
const CACHE = 'mbk-agri-v1';
const SHELL = ['/agriculteur', '/agriculteur/app.js', '/agriculteur/manifest.webmanifest', '/agriculteur/icon-192.png', '/style.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // jamais de cache pour les données (API), ni pour les envois
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/agriculteur/api')) return;
  // réseau d'abord (toujours la dernière version), repli sur la copie en cache hors connexion
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && SHELL.includes(url.pathname)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
