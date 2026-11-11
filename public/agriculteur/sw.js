// Service worker de l'espace agriculteur : l'application s'ouvre même sans réseau (l'écran ; les données viennent de la mémoire du téléphone).
const CACHE = 'mbk-agri-v3';
const PHOTOS = 'mbk-photos'; // photos des plantes (relayées par le serveur), gardées pour l'affichage hors connexion
const SHELL = ['/agriculteur', '/agriculteur/app.js', '/agriculteur/manifest.webmanifest', '/agriculteur/icon-192.png', '/style.css', '/img/emblem.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== PHOTOS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // photos relayées : le contenu d'une photo ne change jamais à la même adresse → copie en cache d'abord, sinon réseau puis copie
  if (e.request.method === 'GET' && url.origin === location.origin && url.pathname === '/agriculteur/api/photo') {
    e.respondWith(caches.open(PHOTOS).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
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
