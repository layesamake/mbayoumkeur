// Service worker de l'espace agriculteur : l'application s'ouvre même sans réseau (l'écran ; les données viennent de la mémoire du téléphone).
const CACHE = 'mbk-agri-v8';
const PHOTOS = 'mbk-photos'; // photos des plantes (relayées par le serveur), gardées pour l'affichage hors connexion
const SHELL = ['/agriculteur', '/agriculteur/app.js', '/agriculteur/partage.js', '/agriculteur/manifest.webmanifest', '/agriculteur/icon-192.png', '/style.css', '/img/emblem.png',
  '/fonts/fraunces-latin.woff2', '/fonts/source-sans-3-400.woff2', '/fonts/source-sans-3-600.woff2', '/fonts/source-sans-3-700.woff2'];

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

/* ---------------------------------------------------------------------------------------------------------------------------
 * Envoi en tâche de fond (Background Sync, Chrome et Edge sur Android) : l'application enregistre l'événement « mbk-flush » quand un
 * enregistrement est mis en attente ; dès que le réseau revient, le navigateur réveille ce service worker, MÊME APPLICATION FERMÉE,
 * et il envoie la file d'attente gardée dans IndexedDB. Même format d'envoi que app.js (toForm/sendEntry) : à garder identiques.
 * Sans cette API (Safari, Firefox), l'envoi reste celui de l'application ouverte.
 * ------------------------------------------------------------------------------------------------------------------------- */
const NETERR = [502, 503, 504];
function swDb() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open('mbk-agri', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('queue', { keyPath: 'key' }); r.result.createObjectStore('cache', { keyPath: 'k' }); };
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}
async function swStore(mode, fn) {
  const d = await swDb();
  return new Promise((ok, ko) => {
    const t = d.transaction('queue', mode), req = fn(t.objectStore('queue'));
    t.oncomplete = () => { d.close(); ok(req?.result); }; t.onerror = t.onabort = () => { d.close(); ko(t.error); };
  });
}
const swExt = (b) => (b.type === 'image/webp' ? 'webp' : 'jpg');
function swRequest(e) {
  const hdr = { 'X-Requested-With': 'fetch' };
  if (e.type === 'stock') return [`/agriculteur/api/plantes/${e.plantId}/disponibilite`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' }, body: JSON.stringify({ disponible: e.disponible }) }];
  const fd = new FormData();
  for (const [k, v] of Object.entries(e.fields)) fd.append(k, v);
  if (e.type === 'create') fd.append('cle', e.key);
  if (e.blob) fd.append('photo', e.blob, 'plante.' + swExt(e.blob));
  (e.extras || []).slice(0, 4).forEach((b, i) => fd.append('extra_' + (i + 1), b, `plante-${i + 2}.` + swExt(b)));
  if ((e.retirer || []).length) fd.append('retirer', e.retirer.join(','));
  return [e.type === 'create' ? '/agriculteur/api/plantes' : `/agriculteur/api/plantes/${e.plantId}`, { method: 'POST', headers: hdr, body: fd }];
}
/**
 * Envoie la file d'attente de l'agriculteur connecté. `d` : { all, put, del, fetch } (injectés pour les essais).
 * Lève une erreur si le réseau manque (le navigateur réessaiera plus tard) ; retourne le nombre d'enregistrements envoyés.
 */
async function swFlush(d) {
  const meRes = await d.fetch('/agriculteur/api/session', { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' });
  if (NETERR.includes(meRes.status)) throw new Error('reseau');
  if (!meRes.ok) return 0;                                   // pas connecté : rien n'est envoyé (l'agriculteur se reconnectera)
  const me = await meRes.json();
  let sent = 0;
  for (const e of (await d.all()).filter((q) => q.user === me.id && !q.error).sort((a, b) => a.createdAt - b.createdAt)) {
    const [url, init] = swRequest(e);
    const res = await d.fetch(url, { ...init, credentials: 'same-origin' });  // une coupure réseau lève ici : réessai plus tard
    if (res.ok) { await d.del(e.key); sent++; continue; }
    const data = await res.json().catch(() => null);
    if (NETERR.includes(res.status)) throw new Error('reseau');
    if (res.status === 401 || data?.code === 'session') break;                 // session expirée : à refaire dans l'application
    if (res.status === 404 && e.type !== 'create') { await d.del(e.key); continue; } // la plante n'existe plus
    e.error = data?.message || 'Erreur du serveur.'; await d.put(e);           // à corriger par l'agriculteur
  }
  return sent;
}
self.addEventListener('sync', (e) => {
  if (e.tag !== 'mbk-flush') return;
  const run = async () => {
    const sent = await swFlush({
      all: () => swStore('readonly', (s) => s.getAll()), put: (x) => swStore('readwrite', (s) => s.put(x)), del: (k) => swStore('readwrite', (s) => s.delete(k)), fetch: (u, o) => fetch(u, o),
    });
    if (sent) for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage({ type: 'mbk-flushed', sent });
  };
  // un seul envoi à la fois, même si l'application ouverte envoie en même temps (verrou partagé avec app.js)
  e.waitUntil(self.navigator?.locks ? self.navigator.locks.request('mbk-flush', run) : run());
});
