// Espace agriculteur : application mobile (PWA) pour saisir ses plantes sur le terrain.
// Pensée pour le plein soleil et les mains sales : gros texte, grosses cibles, actions en bas de l'écran.
// Hors connexion : ce que l'agriculteur enregistre est gardé sur le téléphone (IndexedDB) puis envoyé tout seul au retour du réseau.
(() => {
  'use strict';
  const app = document.getElementById('app');
  const toastBox = document.getElementById('toast');
  // server : plantes connues du serveur ; queue : enregistrements en attente d'envoi ; plantes : ce que l'écran affiche (les deux fusionnés)
  const state = { me: null, config: null, server: [], queue: [], plantes: [], filter: 'tout', form: null, view: '', offline: false, snapAt: 0 };

  /* ----- Dictée vocale (description, conseils) : reconnaissance vocale du navigateur, en français ----- */
  // Chrome et Edge sur Android (et Safari récent) : le micro du téléphone, le texte s'écrit à la suite de ce qui est déjà saisi. Elle demande
  // le réseau (le navigateur envoie la voix à son service de reconnaissance). Sans cette API, le bouton n'est pas affiché.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let dict = null;   // { id, rec, active, base, final, tries }
  // Ponctuation dite à voix haute (« virgule », « point final », « à la ligne »…)
  const spoken = (t) => t
    .replace(/\s*\bpoint d['’]interrogation\b/gi, ' ?').replace(/\s*\bpoint d['’]exclamation\b/gi, ' !')
    .replace(/\s*\bpoint final(?=\s|$)/gi, '.').replace(/\s*\bvirgule\b/gi, ',')
    .replace(/(^|\s)à la ligne(?=\s|$|[,.])\s*/gi, '\n').replace(/\s+([?!])/g, '\u202f$1');
  const joinText = (base, add) => {
    add = spoken(add.replace(/ {2,}/g, ' ').trim()); if (!add) return base;
    const sep = !base || /[\s\n]$/.test(base) || /^[,.\n]/.test(add) ? '' : ' ';
    const out = base + sep + add;
    return /^\s*$/.test(base) ? out.charAt(0).toUpperCase() + out.slice(1) : out;   // majuscule au début d'un champ vide
  };
  function dictNote(id, msg) { const n = document.querySelector(`[data-dnote="${id}"]`); if (n) n.textContent = msg || ''; }
  function dictButtons() {
    document.querySelectorAll('[data-dictee]').forEach((b) => {
      const on = dict?.id === b.dataset.dictee;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('bg-carrot', on); b.classList.toggle('bg-white', !on);
      b.querySelector('span').textContent = on ? 'Arrêter la dictée' : 'Dicter';
    });
  }
  function stopDictation(msg) {
    if (!dict) return;
    const d = dict; dict = null; d.active = false;
    try { d.rec.stop(); } catch {}
    dictButtons(); dictNote(d.id, msg || '');
  }
  function startDictation(id) {
    if (!SR) return;
    if (dict) { const same = dict.id === id; stopDictation(); if (same) return; }
    const el = document.getElementById(id); if (!el) return;
    const key = id === 'f-desc' ? 'description' : 'conseils';
    const d = { id, active: true, tries: 0, rec: null };
    dict = d;
    const begin = () => {
      const rec = d.rec = new SR();
      rec.lang = 'fr-FR'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
      const base = el.value; let got = false;
      rec.onresult = (e) => {
        got = true; d.tries = 0;
        // on reconstruit à chaque fois depuis tous les résultats de la session : pas de texte répété
        let fin = '', tmp = '';
        for (const r of e.results) (r.isFinal ? (fin += ' ' + r[0].transcript) : (tmp += ' ' + r[0].transcript));
        el.value = joinText(joinText(base, fin), tmp).slice(0, el.maxLength > 0 ? el.maxLength : undefined);
        state.form[key] = el.value;
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stopDictation('Le micro est refusé. Autorisez-le dans les réglages du navigateur pour ce site.');
        else if (e.error === 'network') stopDictation('La dictée demande une connexion Internet.');
        else if (e.error === 'audio-capture') stopDictation('Aucun micro n’a été trouvé.');
      };
      rec.onend = () => {                                     // le navigateur coupe après un silence : on repart tant que l'agriculteur n'a pas arrêté
        if (dict !== d || !d.active) return;
        if (!got && ++d.tries >= 3) return stopDictation('Je n’ai rien entendu. Appuyez sur Dicter pour réessayer.');
        setTimeout(() => { if (dict === d && d.active) { try { begin(); } catch { stopDictation(); } } }, 250);
      };
      rec.start();
    };
    try { begin(); } catch { dict = null; return dictNote(id, 'La dictée n’a pas pu démarrer.'); }
    dictButtons(); dictNote(id, 'Je vous écoute : parlez, puis appuyez pour arrêter. Dites « virgule », « point final » ou « à la ligne ».');
  }

  /* ----- Photos en ligne visibles hors connexion ----- */
  // Les photos sont sur un autre domaine : le navigateur ne peut pas les garder lui-même de façon fiable. Après chaque actualisation de la
  // liste, l'application les télécharge une fois via le relais du serveur (même domaine), le service worker les garde (cache « mbk-photos »)
  // et une image qui ne charge pas (hors connexion) est relue depuis cette copie.
  const relay = (u) => '/agriculteur/api/photo?u=' + encodeURIComponent(u);
  window.mbkImgFb = (i) => {
    if (i.dataset.u && !i.dataset.r) { i.dataset.r = '1'; i.src = relay(i.dataset.u); }
    else if (i.dataset.fb) i.outerHTML = i.dataset.fb;
  };
  const remoteImg = (url, cls, alt = '', fb = '', lazy = false) => `<img src="${esc(url)}" data-u="${esc(url)}" data-fb="${esc(fb)}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ''} onerror="mbkImgFb(this)" class="${cls}">`;
  let caching = false;
  async function cachePhotos(list) {
    if (caching || !('caches' in window) || !navigator.onLine) return;
    caching = true;
    try {
      const c = await caches.open('mbk-photos');
      const want = [...new Set(list.flatMap((p) => [p.photo, ...(p.galerie || []).map((g) => g.url)]).filter(Boolean))].slice(0, 400);
      const keep = new Set(want.map(relay));
      for (const r of await c.keys()) { const k = new URL(r.url); if (!keep.has(k.pathname + k.search)) await c.delete(r); } // photos retirées ou remplacées
      const todo = [];
      for (const u of want) if (!(await c.match(relay(u)))) todo.push(u);
      let i = 0;
      await Promise.all([0, 1, 2].map(async () => {
        while (i < todo.length && navigator.onLine) {
          const u = todo[i++];
          try { const res = await fetch(relay(u), { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } }); if (res.ok) await c.put(relay(u), res); } catch {}
        }
      }));
    } catch {} finally { caching = false; }
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(n);
  const plural = (n, a, b) => (n > 1 ? b : a);
  const $ = (sel, root = document) => root.querySelector(sel);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

  const ICON = {
    camera: (c = 'w-8 h-8') => `<svg class="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.8"/></svg>`,
    spark: `<svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2Zm7 12 .9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14ZM5 15l.7 2 2 .7-2 .7L5 20.4l-.7-2-2-.7 2-.7L5 15Z"/></svg>`,
    crop: `<svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>`,
    gallery: (c = 'w-6 h-6') => `<svg class="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m21 16-5-5-8 8"/></svg>`,
    mic: `<svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V22"/></svg>`,
    back: `<svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>`,
    leaf: `<svg class="w-14 h-14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 2C9 2 3 6 3 12c0 1.5.5 2.8 1.3 3.8C5 12 8 9 12 7.5 8.5 9.5 6 12.5 5 17c.5.2 1 .3 1.5.3 6 0 10.5-5 10.5-11.5V2Z"/></svg>`,
  };

  /* ---------------- Réseau ---------------- */
  const NET = 'Pas de connexion. Vérifiez votre réseau et réessayez.';
  async function api(path, { method = 'GET', json } = {}) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } };
    if (json) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(json); }
    let res;
    try { res = await fetch('/agriculteur/api' + path, opts); } catch { throw Object.assign(new Error(NET), { offline: true }); }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(data?.message || 'Erreur du serveur.'), { status: res.status, code: data?.code, existant: data?.existant });
    return data;
  }
  // Envoi avec barre de progression (les réseaux de campagne sont lents)
  function upload(path, form, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', '/agriculteur/api' + path);
      x.setRequestHeader('X-Requested-With', 'fetch');
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
      x.onerror = x.ontimeout = () => reject(Object.assign(new Error(NET), { offline: true }));
      x.timeout = 120000;
      x.onload = () => {
        let data = null; try { data = JSON.parse(x.responseText); } catch {}
        if (x.status >= 200 && x.status < 300) resolve(data);
        else reject(Object.assign(new Error(data?.message || 'Erreur du serveur.'), { status: x.status, code: data?.code, existant: data?.existant }));
      };
      x.send(form);
    });
  }
  // Coupure réseau (ou serveur injoignable) : l'envoi est à refaire plus tard, ce n'est pas une erreur de l'agriculteur
  const isNetErr = (e) => Boolean(e?.offline) || [502, 503, 504].includes(e?.status) || e?.code === 'reseau';

  function toast(msg, kind = 'ok') {
    const el = document.createElement('div');
    el.className = `mx-auto max-w-md rounded-2xl px-5 py-4 font-semibold shadow-[0_6px_0_rgba(0,0,0,.2)] ${kind === 'ok' ? 'bg-leaf-900 text-white' : 'bg-carrot text-leaf-900'}`;
    el.textContent = msg;
    toastBox.replaceChildren(el);
    setTimeout(() => el.remove(), 4200);
  }

  /* ---------------- Mémoire du téléphone (IndexedDB) : file d'attente et dernière liste connue ---------------- */
  const hasIDB = typeof indexedDB !== 'undefined';
  function idb() {
    return (idb.p ??= new Promise((ok, ko) => {
      const r = indexedDB.open('mbk-agri', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('queue', { keyPath: 'key' }); r.result.createObjectStore('cache', { keyPath: 'k' }); };
      r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
    }));
  }
  async function store(name, mode, fn) {
    const d = await idb();
    return new Promise((ok, ko) => {
      const t = d.transaction(name, mode), req = fn(t.objectStore(name));
      t.oncomplete = () => ok(req?.result); t.onerror = t.onabort = () => ko(t.error);
    });
  }
  const qAll = () => store('queue', 'readonly', (s) => s.getAll());
  const qPut = (e) => store('queue', 'readwrite', (s) => s.put(e));
  const qDel = (k) => store('queue', 'readwrite', (s) => s.delete(k));
  const cGet = () => store('cache', 'readonly', (s) => s.get('snap'));
  const cPut = (v) => store('cache', 'readwrite', (s) => s.put({ k: 'snap', v, at: Date.now() }));
  const cDel = () => store('cache', 'readwrite', (s) => s.delete('snap'));

  // Photos des enregistrements en attente : adresses locales créées à la demande
  const urls = new Map();
  const urlOf = (e) => { if (!e.blob) return ''; if (!urls.has(e.key)) urls.set(e.key, URL.createObjectURL(e.blob)); return urls.get(e.key); };
  const dropUrl = (key) => { const u = urls.get(key); if (u) { URL.revokeObjectURL(u); urls.delete(key); } };

  const fromFields = (f) => ({ titre: f.titre, nom_local: f.nom_local || '', categorie: f.categorie, prix: Number(f.prix) || 0, conditionnement: f.conditionnement, disponible: f.disponible === '1', description: f.description, conseils: f.conseils, statut: f.statut });

  // Fusionne la liste du serveur et la file d'attente : ce que voit l'agriculteur, avec ses enregistrements pas encore partis
  function rebuild() {
    const list = state.server.map((p) => ({ ...p }));
    const byId = new Map(list.map((p) => [p.id, p]));
    const locals = [];
    for (const e of state.queue) {
      if (e.type === 'create') { locals.push({ id: e.key, local: true, pending: true, erreur: e.error, photo: urlOf(e), ref: '', ...fromFields(e.fields) }); continue; }
      const p = byId.get(e.plantId);
      if (!p) continue;
      if (e.type === 'update') Object.assign(p, fromFields(e.fields), { pending: true, erreur: e.error, ...(e.blob ? { photo: urlOf(e) } : {}) });
      if (e.type === 'stock') Object.assign(p, { disponible: e.disponible, pending: true });
    }
    state.plantes = [...locals, ...list];
  }
  const entryFor = (p) => state.queue.find((e) => e.key === (p.local ? p.id : 'u-' + p.id));

  async function enqueue(entry) {
    if (!hasIDB) throw new Error('Ce téléphone ne peut pas garder l’enregistrement hors connexion.');
    try { await qPut(entry); } catch { throw new Error('Ce téléphone ne peut pas garder l’enregistrement hors connexion.'); }
    const i = state.queue.findIndex((q) => q.key === entry.key);
    if (i >= 0) state.queue[i] = entry; else state.queue.push(entry);
    dropUrl(entry.key); rebuild(); requestBgSync();
  }
  async function dequeue(key) {
    try { await qDel(key); } catch {}
    state.queue = state.queue.filter((q) => q.key !== key); dropUrl(key); rebuild();
  }
  const mergeServer = (saved) => { const i = state.server.findIndex((p) => p.id === saved.id); if (i >= 0) state.server[i] = saved; else state.server.unshift(saved); };

  const ext = (b) => (b.type === 'image/webp' ? 'webp' : 'jpg');
  // Photo principale (photo) + photos supplémentaires (extra_1 à extra_4, 5 photos au maximum) + photos à retirer (identifiants)
  function toForm(fields, blob, cle, extras = [], retirer = []) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (cle) fd.append('cle', cle);
    if (blob) fd.append('photo', blob, 'plante.' + ext(blob));
    extras.slice(0, 4).forEach((b, i) => fd.append('extra_' + (i + 1), b, `plante-${i + 2}.` + ext(b)));
    if (retirer.length) fd.append('retirer', retirer.join(','));
    return fd;
  }
  const sendEntry = (e, onProgress = () => {}) =>
    e.type === 'create' ? upload('/plantes', toForm(e.fields, e.blob, e.key, e.extras, e.retirer), onProgress)
      : e.type === 'update' ? upload(`/plantes/${e.plantId}`, toForm(e.fields, e.blob, null, e.extras, e.retirer), onProgress)
        : api(`/plantes/${e.plantId}/disponibilite`, { method: 'POST', json: { disponible: e.disponible } });

  /* ----- Envoi des enregistrements en attente ----- */
  let flushing = false;
  // Demande l'envoi en tâche de fond : le navigateur réveille le service worker dès que le réseau revient, même application fermée
  // (Chrome / Edge sur Android ; ailleurs, l'envoi reste celui de l'application ouverte)
  async function requestBgSync() {
    try { const reg = await navigator.serviceWorker?.ready; await reg?.sync?.register('mbk-flush'); } catch {}
  }
  async function flush(force = false) {
    if (flushing || !state.me || !state.queue.length || !navigator.onLine) return;
    flushing = true;
    try {
      if (navigator.locks) await navigator.locks.request('mbk-flush', () => flushLocked(force)); else await flushLocked(force);
    } finally { flushing = false; }
  }
  async function flushLocked(force) {
    // le service worker a peut-être déjà envoyé une partie de la file : on la relit
    if (hasIDB) { try { state.queue = (await qAll()).filter((q) => q.user === state.me.id); rebuild(); } catch {} }
    if (!state.queue.length) return;
    let sent = 0, stopped = false;
    try {
      for (const e of [...state.queue].sort((a, b) => a.createdAt - b.createdAt)) {
        if (e.error && !force) continue;                // refusé par le serveur : attend que l'agriculteur le corrige
        try {
          const saved = await sendEntry(e);
          if (e.type !== 'stock' && saved?.id) mergeServer(saved);
          await dequeue(e.key); sent++;
        } catch (err) {
          if (err.code === 'session') { stopped = true; sessionLost(); break; }  // connexion à refaire : rien n'est perdu
          if (isNetErr(err)) break;                     // réseau toujours absent : on réessaiera
          if (err.status === 404 && e.type !== 'create') { await dequeue(e.key); continue; } // la plante n'existe plus
          e.error = err.message; try { await qPut(e); } catch {}                // à corriger par l'agriculteur
        }
      }
    } finally { /* verrou libéré par flush */ }
    if (stopped) return;
    if (sent) { await refreshServer(); toast(`${sent} ${plural(sent, 'enregistrement envoyé', 'enregistrements envoyés')}`); }
    rebuild(); refreshView();
  }
  async function refreshServer() {
    try { const { plantes } = await api('/plantes'); state.server = plantes; state.offline = false; cPut({ me: state.me, config: state.config, plantes }).catch(() => {}); rebuild(); cachePhotos(plantes); } catch {}
  }
  const refreshView = () => { if (state.view === 'home') viewHome(); };

  /* ---------------- Photos : recadrage, puis traitement automatique à la publication ---------------- */
  // La photo prise reste intacte sur le téléphone (aperçu, recadrage, rotation). Au clic sur « Publier » ou « Brouillon », elle est
  // recadrée, redimensionnée (1600 px au plus), convertie en WebP et débarrassée de ses métadonnées (donc de la position GPS) :
  // 4 à 8 Mo en sortie d'appareil photo seraient trop lourds en 3G, on envoie ~200–400 Ko.
  const toBlob = async (c, q = 0.8) => {
    let b = await new Promise((r) => c.toBlob(r, 'image/webp', q));
    if (!b || b.type !== 'image/webp') b = await new Promise((r) => c.toBlob(r, 'image/jpeg', q + 0.02)); // Safari ne sait pas écrire en WebP
    return b;
  };
  async function loadBitmap(src) {
    try { return await createImageBitmap(src, { imageOrientation: 'from-image' }); }
    catch { return await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(src); }); }
  }
  const dims = (b) => [b.width || b.naturalWidth, b.height || b.naturalHeight];
  // Image redressée puis pivotée (rot : 0, 90, 180 ou 270), au plus `max` pixels sur le grand côté
  function oriented(bmp, rot, max) {
    const [w, h] = dims(bmp), quarter = rot % 180 !== 0, rw = quarter ? h : w, rh = quarter ? w : h;
    const k = Math.min(1, max / Math.max(rw, rh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(rw * k)); c.height = Math.max(1, Math.round(rh * k));
    const g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2); g.rotate((rot * Math.PI) / 180);
    g.drawImage(bmp, -(w * k) / 2, -(h * k) / 2, w * k, h * k);
    return c;
  }
  // Luminosité, contraste, saturation (de -100 à 100, 0 = inchangé), mêmes formules que filter: brightness() contrast() saturate()
  const hasAdj = (a) => !!a && (a.b || a.c || a.s);
  const cssFilter = (a) => (hasAdj(a) ? `brightness(${1 + a.b / 100}) contrast(${1 + a.c / 100}) saturate(${1 + a.s / 100})` : 'none');
  function applyAdjust(canvas, a) {
    if (!hasAdj(a)) return;
    const g = canvas.getContext('2d'), img = g.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
    const B = 1 + a.b / 100, C = 1 + a.c / 100, S = Math.max(0, 1 + a.s / 100);
    const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
    for (let i = 0; i < d.length; i += 4) {
      let r = cl(d[i] * B), gg = cl(d[i + 1] * B), b = cl(d[i + 2] * B);
      r = cl((r - 127.5) * C + 127.5); gg = cl((gg - 127.5) * C + 127.5); b = cl((b - 127.5) * C + 127.5);
      d[i] = cl((0.213 + 0.787 * S) * r + (0.715 - 0.715 * S) * gg + (0.072 - 0.072 * S) * b);
      d[i + 1] = cl((0.213 - 0.213 * S) * r + (0.715 + 0.285 * S) * gg + (0.072 - 0.072 * S) * b);
      d[i + 2] = cl((0.213 - 0.213 * S) * r + (0.715 - 0.715 * S) * gg + (0.072 + 0.928 * S) * b);
    }
    g.putImageData(img, 0, 0);
  }
  // Rend la photo (avec son recadrage : fractions x, y, w, h de l'image pivotée) en un Blob de `max` pixels au plus
  async function renderPhoto(p, max = 1600, q = 0.8) {
    const bmp = await loadBitmap(p.source);
    const cr = p.crop || { rot: 0, x: 0, y: 0, w: 1, h: 1 };
    const [bw, bh] = dims(bmp), quarter = cr.rot % 180 !== 0, rw = quarter ? bh : bw, rh = quarter ? bw : bh;
    const k = Math.min(1, max / Math.max(cr.w * rw, cr.h * rh));
    const full = oriented(bmp, cr.rot, Math.max(rw, rh) * k);   // l'image entière, déjà à l'échelle finale
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(cr.w * full.width)); out.height = Math.max(1, Math.round(cr.h * full.height));
    out.getContext('2d').drawImage(full, cr.x * full.width, cr.y * full.height, cr.w * full.width, cr.h * full.height, 0, 0, out.width, out.height);
    if (bmp.close) bmp.close();
    applyAdjust(out, cr.adj);
    return toBlob(out, q);
  }
  // Une photo du formulaire : l'original (source), son recadrage éventuel, un aperçu, et le résultat traité une fois calculé
  const mkPhoto = (source, processed = null) => ({ source, url: URL.createObjectURL(source), preview: '', crop: null, processed, _light: null });
  const shown = (p) => p.preview || p.url;
  const dropPhoto = (p) => { if (!p) return; URL.revokeObjectURL(p.url); if (p.preview) URL.revokeObjectURL(p.preview); };
  const finalBlob = async (p) => (p.processed ??= await renderPhoto(p, 1600, 0.8));   // calculé à la publication, une seule fois
  const lightBlob = async (p) => (p._light ??= await renderPhoto(p, 1024, 0.75));     // version légère pour l'assistant
  async function refreshPreview(p) {
    const b = await renderPhoto(p, 900, 0.8);
    if (p.preview) URL.revokeObjectURL(p.preview);
    p.preview = URL.createObjectURL(b);
  }

  /* ----- Éditeur de recadrage : on glisse la photo sous le cadre, on pince ou on règle le zoom ----- */
  const RATIOS = [['orig', 'Original', 0], ['1:1', 'Carré', 1], ['4:3', 'Paysage', 4 / 3], ['3:4', 'Portrait', 3 / 4]];
  async function openCropper(photo) {
    const bmp = await loadBitmap(photo.source);
    return new Promise((resolve) => {
      const st = { adj: { b: photo.crop?.adj?.b || 0, c: photo.crop?.adj?.c || 0, s: photo.crop?.adj?.s || 0 }, tab: 'crop', rot: photo.crop?.rot || 0, ratio: photo.crop?.ratio || '1:1', zoom: photo.crop?.zoom || 1, cx: photo.crop?.cx ?? 0.5, cy: photo.crop?.cy ?? 0.5 };
      let wc;
      const ov = document.createElement('div');
      ov.id = 'cropper'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Recadrer et retoucher la photo');
      ov.className = 'fixed inset-0 z-[70] bg-black text-white flex flex-col';
      ov.innerHTML = `
        <header class="flex items-center justify-between gap-3 px-3 pt-[max(.75rem,env(safe-area-inset-top))] pb-3">
          <button type="button" data-c="cancel" class="min-h-12 px-5 rounded-full border-2 border-white/50 font-bold text-lg">Annuler</button>
          <h2 class="font-display font-bold text-xl">Retoucher</h2>
          <button type="button" data-c="ok" class="min-h-12 px-6 rounded-full bg-carrot text-leaf-900 font-display font-extrabold text-xl">Valider</button>
        </header>
        <div id="crop-area" class="relative flex-1 overflow-hidden touch-none select-none bg-neutral-900" tabindex="0" role="group" aria-label="Zone de recadrage : glissez la photo pour la déplacer, pincez pour agrandir. Au clavier : flèches pour déplacer, plus et moins pour le zoom.">
          <canvas id="crop-img" class="absolute max-w-none"></canvas>
          <div id="crop-frame" class="absolute border-2 border-white pointer-events-none" style="box-shadow:0 0 0 9999px rgba(0,0,0,.62)"></div>
        </div>
        <div class="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 bg-leaf-900">
          <div class="flex items-center gap-2" role="group" aria-label="Que modifier ?">
            <button type="button" data-tab="crop" aria-pressed="true" class="flex-1 min-h-12 rounded-full border-2 border-white/50 font-bold aria-pressed:bg-white aria-pressed:text-leaf-900 aria-pressed:border-white">Cadrer</button>
            <button type="button" data-tab="adj" aria-pressed="false" class="flex-1 min-h-12 rounded-full border-2 border-white/50 font-bold aria-pressed:bg-white aria-pressed:text-leaf-900 aria-pressed:border-white">Couleurs</button>
          </div>
          <div data-panel="crop" class="space-y-3">
          <div class="flex items-center gap-2" role="group" aria-label="Format du cadre">
            ${RATIOS.map((r) => `<button type="button" data-ratio="${r[0]}" aria-pressed="false" class="flex-1 min-h-12 rounded-full border-2 border-white/50 font-bold aria-pressed:bg-white aria-pressed:text-leaf-900 aria-pressed:border-white">${r[1]}</button>`).join('')}
            <button type="button" data-c="rotate" aria-label="Pivoter d’un quart de tour" class="min-h-12 w-14 rounded-full border-2 border-white/50 font-bold text-2xl leading-none">⟳</button>
          </div>
          <label class="flex items-center gap-3 font-semibold">Zoom <input id="crop-zoom" type="range" min="1" max="5" step="0.01" value="1" class="flex-1 h-8 accent-[#fc7404]"></label>
          </div>
          <div data-panel="adj" class="hidden space-y-1">
            ${[['b', 'Luminosité', -60, 60], ['c', 'Contraste', -60, 60], ['s', 'Couleurs', -100, 100]].map((a) => `<label class="flex items-center gap-3 font-semibold"><span class="w-28">${a[1]}</span><input data-adj="${a[0]}" type="range" min="${a[2]}" max="${a[3]}" step="1" value="0" aria-label="${a[1]}" class="flex-1 h-9 accent-[#fc7404]"></label>`).join('')}
            <button type="button" data-c="reset" class="min-h-12 px-4 underline underline-offset-4 font-semibold">Remettre à zéro</button>
          </div>
        </div>`;
      document.body.appendChild(ov); document.body.style.overflow = 'hidden';
      const area = ov.querySelector('#crop-area'), cv = ov.querySelector('#crop-img'), frame = ov.querySelector('#crop-frame'), zoomEl = ov.querySelector('#crop-zoom');
      const clamp = (z) => Math.min(5, Math.max(1, z));
      const geo = () => {
        const A = area.getBoundingClientRect(), r = st.ratio === 'orig' ? wc.width / wc.height : RATIOS.find((x) => x[0] === st.ratio)[2], pad = 20;
        let fw = Math.max(40, A.width - pad * 2), fh = fw / r;
        if (fh > A.height - pad * 2) { fh = Math.max(40, A.height - pad * 2); fw = fh * r; }
        const iw = wc.width, ih = wc.height, s = Math.max(fw / iw, fh / ih) * st.zoom;
        return { A, fw, fh, iw, ih, s, hx: fw / (2 * s * iw), hy: fh / (2 * s * ih) };
      };
      const build = () => { wc = oriented(bmp, st.rot, 1600); cv.width = wc.width; cv.height = wc.height; cv.getContext('2d').drawImage(wc, 0, 0); };
      const draw = () => {
        const g = geo();
        st.cx = g.hx >= 0.5 ? 0.5 : Math.min(1 - g.hx, Math.max(g.hx, st.cx));
        st.cy = g.hy >= 0.5 ? 0.5 : Math.min(1 - g.hy, Math.max(g.hy, st.cy));
        cv.style.width = g.iw * g.s + 'px'; cv.style.height = g.ih * g.s + 'px';
        cv.style.left = g.A.width / 2 - st.cx * g.iw * g.s + 'px'; cv.style.top = g.A.height / 2 - st.cy * g.ih * g.s + 'px';
        frame.style.width = g.fw + 'px'; frame.style.height = g.fh + 'px'; frame.style.left = (g.A.width - g.fw) / 2 + 'px'; frame.style.top = (g.A.height - g.fh) / 2 + 'px';
        zoomEl.value = st.zoom; cv.style.filter = cssFilter(st.adj);
        ov.querySelectorAll('[data-adj]').forEach((i) => { i.value = st.adj[i.dataset.adj]; });
        ov.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === st.tab)));
        ov.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== st.tab));
        ov.querySelectorAll('[data-ratio]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ratio === st.ratio)));
      };
      const ptrs = new Map(); let pinch = 0;
      area.addEventListener('pointerdown', (e) => { area.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); pinch = 0; });
      area.addEventListener('pointermove', (e) => {
        if (!ptrs.has(e.pointerId)) return;
        const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
        const g = geo();
        if (ptrs.size === 1) { st.cx -= (e.clientX - prev[0]) / (g.s * g.iw); st.cy -= (e.clientY - prev[1]) / (g.s * g.ih); }
        else if (ptrs.size === 2) {
          const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (pinch) st.zoom = clamp(st.zoom * (d / pinch));
          pinch = d;
        }
        draw();
      });
      const up = (e) => { ptrs.delete(e.pointerId); pinch = 0; };
      area.addEventListener('pointerup', up); area.addEventListener('pointercancel', up);
      area.addEventListener('wheel', (e) => { e.preventDefault(); st.zoom = clamp(st.zoom * (e.deltaY < 0 ? 1.1 : 0.9)); draw(); }, { passive: false });
      area.addEventListener('keydown', (e) => {
        const step = 0.03;
        if (e.key === 'ArrowLeft') st.cx -= step; else if (e.key === 'ArrowRight') st.cx += step;
        else if (e.key === 'ArrowUp') st.cy -= step; else if (e.key === 'ArrowDown') st.cy += step;
        else if (e.key === '+' || e.key === '=') st.zoom = clamp(st.zoom * 1.1); else if (e.key === '-') st.zoom = clamp(st.zoom / 1.1); else return;
        e.preventDefault(); draw();
      });
      zoomEl.addEventListener('input', () => { st.zoom = clamp(Number(zoomEl.value)); draw(); });
      ov.querySelectorAll('[data-adj]').forEach((i) => i.addEventListener('input', () => { st.adj[i.dataset.adj] = Number(i.value); draw(); }));
      const onKey = (e) => { if (e.key === 'Escape') close(false); };
      const onResize = () => draw();
      window.addEventListener('keydown', onKey); window.addEventListener('resize', onResize);
      function close(ok) {
        if (ok) { const g = geo(); photo.crop = { adj: hasAdj(st.adj) ? { ...st.adj } : null, rot: st.rot, ratio: st.ratio, zoom: st.zoom, cx: st.cx, cy: st.cy, x: st.cx - g.hx, y: st.cy - g.hy, w: 2 * g.hx, h: 2 * g.hy }; }
        window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize);
        ov.remove(); document.body.style.overflow = ''; if (bmp.close) bmp.close();
        resolve(ok);
      }
      ov.addEventListener('click', (e) => {
        const c = e.target.closest('[data-c]')?.dataset.c, r = e.target.closest('[data-ratio]')?.dataset.ratio;
        const tab = e.target.closest('[data-tab]')?.dataset.tab;
        if (tab) { st.tab = tab; draw(); }
        else if (c === 'reset') { st.adj = { b: 0, c: 0, s: 0 }; draw(); }
        else if (c === 'cancel') close(false); else if (c === 'ok') close(true);
        else if (c === 'rotate') { st.rot = (st.rot + 90) % 360; st.cx = st.cy = 0.5; st.zoom = 1; build(); draw(); }
        else if (r) { st.ratio = r; draw(); }
      });
      build(); draw(); ov.querySelector('[data-c="ok"]').focus();
    });
  }
  async function cropPhoto(p) {
    let ok;
    try { ok = await openCropper(p); } catch { return toast('Cette photo n’a pas pu être ouverte pour le recadrage.', 'err'); }
    if (!ok) return;
    p.processed = null; p._light = null;                 // le recadrage a changé : le traitement sera refait à la publication
    try { await refreshPreview(p); } catch {}
    const f = state.form; if (!f) return;
    if (f.main === p) { $('#photo').innerHTML = photoBlock(); f.ident = null; renderIdent(); } else renderExtras();
  }
  async function fetchOnline(url) {
    if (!navigator.onLine) throw Object.assign(new Error('offline'), { offline: true });
    const res = await fetch('/agriculteur/api/photo?u=' + encodeURIComponent(url), { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } });
    if (!res.ok) throw new Error('photo');
    return res.blob();
  }
  // Retouche d'une photo déjà en ligne : on la relit, l'éditeur s'ouvre ; seulement si on valide, elle remplace l'ancienne à l'enregistrement
  async function editOnline(kind, galId) {
    const f = state.form; if (!f || f.busy) return;
    const url = kind === 'main' ? (f.photoFull || f.photoUrl) : f.gallery.find((g) => g.id === galId)?.full;
    if (!url) return;
    toast('Ouverture de la photo…');
    let p;
    try { p = mkPhoto(await fetchOnline(url)); }
    catch (err) { return toast(err.offline ? 'Hors connexion : une photo déjà en ligne ne peut pas être retouchée maintenant. Reprenez-la plus tard, ou prenez-en une nouvelle.' : 'Cette photo n’a pas pu être ouverte. Réessayez.', 'err'); }
    let ok;
    try { ok = await openCropper(p); } catch { dropPhoto(p); return toast('Cette photo n’a pas pu être ouverte pour la retouche.', 'err'); }
    if (!ok) { dropPhoto(p); return; }
    try { await refreshPreview(p); } catch {}
    if (state.form !== f) { dropPhoto(p); return; }
    if (kind === 'main') { dropPhoto(f.main); f.main = p; f.photoUrl = ''; f.photoFull = ''; f.ident = null; $('#photo').innerHTML = photoBlock(); renderIdent(); }
    else { f.removed.push(galId); f.gallery = f.gallery.filter((g) => g.id !== galId); f.extras.push(p); renderExtras(); }
  }
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko');

  /* ---------------- Écrans ---------------- */
  const bannerText = () => (navigator.onLine ? '' : `<p role="status" class="bg-carrot text-leaf-900 font-bold text-center px-4 py-3">Hors connexion. Ce que vous enregistrez reste sur le téléphone et part dès que le réseau revient.</p>`);
  const banner = () => `<div id="net">${bannerText()}</div>`;
  const updateBanner = () => { const el = $('#net'); if (el) el.innerHTML = bannerText(); };

  function viewLogin(msg = '') {
    state.view = 'login';
    app.innerHTML = `
    <main class="min-h-screen bg-leaf-900 text-white flex flex-col px-6 pt-[max(2.5rem,env(safe-area-inset-top))] pb-8">
      ${banner()}
      <div class="mt-6 w-20 h-20 rounded-full bg-sun-soft text-leaf-900 flex items-center justify-center" aria-hidden="true"><img src="/img/emblem.png" alt="" width="64" height="64" class="w-14 h-14 object-contain"></div>
      <h1 class="mt-6 font-display font-extrabold text-4xl leading-[1.05]">Espace agriculteur</h1>
      <p class="mt-3 text-leaf-100 text-xl max-w-[28ch]">Ajoutez vos plantes depuis le terrain, en quelques gestes.</p>
      <form id="login" class="mt-8 space-y-4" novalidate>
        <div><label for="u" class="block font-semibold mb-1.5">Identifiant</label>
          <input id="u" name="u" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" class="w-full h-14 rounded-2xl px-4 text-xl text-leaf-900 bg-white focus:outline-none focus:ring-4 focus:ring-carrot"></div>
        <div><label for="p" class="block font-semibold mb-1.5">Mot de passe</label>
          <div class="relative"><input id="p" name="p" type="password" autocomplete="current-password" enterkeyhint="go" class="w-full h-14 rounded-2xl pl-4 pr-24 text-xl text-leaf-900 bg-white focus:outline-none focus:ring-4 focus:ring-carrot">
          <button type="button" id="show" class="absolute right-1.5 top-1.5 h-11 px-4 rounded-xl text-leaf-700 font-bold" aria-pressed="false">Voir</button></div></div>
        <p id="err" role="alert" class="${msg ? '' : 'hidden'} rounded-2xl bg-carrot text-leaf-900 font-bold px-4 py-3">${esc(msg)}</p>
        <button class="w-full min-h-16 rounded-full bg-carrot text-leaf-900 font-display font-extrabold text-2xl shadow-[0_5px_0_rgba(0,0,0,.25)] active:translate-y-[3px] active:shadow-none">Se connecter</button>
      </form>
      <p class="mt-auto pt-10 text-center"><a href="/" class="inline-flex items-center justify-center gap-2 min-h-14 px-6 rounded-full border-2 border-white/50 font-semibold text-lg active:bg-white/10">${ICON.back}Retour au site Mbayoumkeur</a></p>
    </main>`;
    const form = $('#login'), err = $('#err');
    $('#show').addEventListener('click', (e) => { const p = $('#p'); const on = p.type === 'password'; p.type = on ? 'text' : 'password'; e.currentTarget.textContent = on ? 'Cacher' : 'Voir'; e.currentTarget.setAttribute('aria-pressed', on); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button.w-full'); btn.disabled = true; btn.textContent = 'Connexion…'; err.classList.add('hidden');
      try {
        const out = await api('/login', { method: 'POST', json: { identifiant: $('#u').value.trim(), motdepasse: $('#p').value } });
        state.me = { nom: out.nom, id: out.id };
        await boot();
      } catch (ex) {
        err.textContent = ex.message; err.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Se connecter';
      }
    });
  }

  const UNIT = (v) => state.config?.conditionnements.find((u) => u.valeur === v)?.label.toLowerCase() || v;
  const icon = (slug) => state.config?.univers.find((u) => u.slug === slug)?.icone || '🪴';

  function card(p) {
    const online = p.statut === 'publish';
    const chip = p.local ? ['border-2 border-dashed border-leaf-600 bg-white', 'En attente d’envoi']
      : p.pending ? ['border-2 border-dashed border-leaf-600 bg-white', 'Modification en attente']
        : online ? ['bg-leaf-100', 'En ligne'] : ['bg-sun-soft', 'Brouillon'];
    const fallback = `<span aria-hidden="true">${icon(p.categorie)}</span>`;
    return `
    <li class="bg-white rounded-3xl border-2 ${p.erreur ? 'border-carrot' : 'border-leaf-100'} p-3 flex gap-3 items-stretch">
      <a href="#/plante/${p.id}" class="shrink-0 w-20 h-20 rounded-2xl overflow-hidden bg-leaf-50 flex items-center justify-center text-4xl" aria-label="Modifier ${esc(p.titre)}">
        ${p.photo ? remoteImg(p.photo, 'w-full h-full object-cover ' + (p.disponible ? '' : 'opacity-50 grayscale'), '', fallback, true) : `<span aria-hidden="true">${icon(p.categorie)}</span>`}
      </a>
      <div class="flex-1 min-w-0 flex flex-col justify-between">
        <div>
          <a href="#/plante/${p.id}" class="block font-display font-bold text-xl leading-tight line-clamp-2 break-words">${esc(p.titre)}</a>
          ${p.nom_local ? `<p class="text-base italic text-slate-700 line-clamp-1 break-words">${esc(p.nom_local)}</p>` : ''}
          <p class="text-slate-700">${p.prix ? fcfa(p.prix) + ' FCFA' + (p.conditionnement ? ' / ' + esc(UNIT(p.conditionnement)) : '') : 'Prix sur demande'}</p>
        </div>
        <span class="self-start rounded-full px-3 py-0.5 text-base font-bold text-leaf-900 ${chip[0]}">${chip[1]}</span>
        ${p.erreur ? `<p class="mt-1 text-base font-semibold text-red-800">À corriger : ${esc(p.erreur)}</p>` : ''}
      </div>
      <label class="shrink-0 flex flex-col items-center justify-center gap-1.5 w-[4.25rem] cursor-pointer">
        <input type="checkbox" data-stock="${p.id}" class="peer sr-only" ${p.disponible ? 'checked' : ''}>
        <span class="switch peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-carrot" aria-hidden="true"></span>
        <span class="text-sm font-bold" data-stock-label="${p.id}">${p.disponible ? 'En stock' : 'Épuisé'}</span>
      </label>
    </li>`;
  }

  function viewHome() {
    state.view = 'home';
    const all = state.plantes;
    const real = all.filter((p) => !p.local);
    const on = real.filter((p) => p.statut === 'publish' && !p.pending).length;
    const n = state.queue.length;
    const shown = all.filter((p) => state.filter === 'tout' || (state.filter === 'ligne' ? p.statut === 'publish' : p.statut !== 'publish'));
    const tab = (k, label) => `<button type="button" role="tab" aria-selected="${state.filter === k}" data-filter="${k}" class="min-h-12 rounded-xl font-bold ${state.filter === k ? 'bg-leaf-900 text-white' : 'text-leaf-900'}">${label}</button>`;
    const snap = state.offline && state.snapAt ? `<p class="mt-1 text-leaf-100 text-sm">Liste enregistrée le ${new Date(state.snapAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>` : '';
    app.innerHTML = `
    ${banner()}
    <header class="sticky top-0 z-30 bg-leaf-900 text-white px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-4">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0"><p class="text-leaf-100 text-base">Bonjour</p><h1 class="font-display font-extrabold text-3xl leading-none truncate">${esc(state.me.nom)}</h1></div>
        <button type="button" data-act="logout" class="shrink-0 min-h-12 px-5 rounded-full border-2 border-white/40 font-semibold">Quitter</button>
      </div>
      <p class="mt-3 text-leaf-100"><strong class="font-display text-white text-2xl">${real.length}</strong> ${plural(real.length, 'plante', 'plantes')}, dont <strong class="font-display text-white text-2xl">${on}</strong> en ligne</p>${snap}
    </header>
    <main class="px-4 pt-4 pb-36">
      ${n ? `
      <section role="status" class="mb-4 rounded-2xl bg-sun-soft p-4">
        <p class="font-display font-extrabold text-xl">${n} ${plural(n, 'enregistrement', 'enregistrements')} en attente d’envoi</p>
        <p class="mt-0.5 text-base">${navigator.onLine ? 'Envoi en cours dès que possible.' : 'Ils partiront dès que le réseau revient. Rien n’est perdu.'}</p>
        ${navigator.onLine ? `<button type="button" data-act="flush" class="mt-3 min-h-12 px-5 rounded-full bg-leaf-900 text-white font-bold">Envoyer maintenant</button>` : ''}
      </section>` : ''}
      <div role="tablist" aria-label="Filtrer mes plantes" class="grid grid-cols-3 gap-1.5 p-1.5 bg-white rounded-2xl border-2 border-leaf-100">
        ${tab('tout', 'Toutes')}${tab('ligne', 'En ligne')}${tab('brouillon', 'Brouillons')}
      </div>
      ${shown.length ? `<ul class="mt-4 space-y-3">${shown.map(card).join('')}</ul>` : `
      <div class="mt-6 rounded-3xl border-4 border-dashed border-leaf-100 bg-white px-6 py-12 text-center">
        <div class="text-leaf-600 flex justify-center" aria-hidden="true">${ICON.leaf}</div>
        <p class="mt-3 font-display font-extrabold text-2xl">${all.length ? 'Rien dans cette liste' : 'Aucune plante pour l’instant'}</p>
        <p class="mt-1 text-slate-700">${all.length ? 'Changez de filtre ci-dessus.' : 'Prenez votre première photo avec le bouton orange.'}</p>
      </div>`}
    </main>
    <div class="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t-2 border-leaf-100 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
      <a href="#/nouvelle" class="flex items-center justify-center gap-3 min-h-16 rounded-full bg-carrot text-leaf-900 font-display font-extrabold text-2xl shadow-[0_5px_0_rgba(0,0,0,.2)] active:translate-y-[3px] active:shadow-none">${ICON.camera()}Nouvelle plante</a>
    </div>`;
  }

  /* ----- Formulaire (création et modification) ----- */
  const pill = (name, value, label, checked, extra = '') => `
    <label class="cursor-pointer"><input type="radio" name="${name}" value="${esc(value)}" class="peer sr-only" ${checked ? 'checked' : ''}>
    <span class="inline-flex items-center justify-center min-h-14 px-5 rounded-full border-2 border-leaf-100 bg-white font-bold text-lg peer-checked:bg-leaf-900 peer-checked:text-white peer-checked:border-leaf-900 peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-carrot">${esc(label)}</span></label>`;

  function photoBlock() {
    const f = state.form;
    const src = f.main ? shown(f.main) : f.photoUrl;
    const inputs = `<input id="cam" type="file" accept="image/*" capture="environment" class="sr-only"><input id="gal" type="file" accept="image/*" class="sr-only">`;
    const btn = 'flex flex-col items-center justify-center gap-1.5 min-h-20 px-1 py-3 rounded-2xl border-2 border-leaf-900 bg-white font-bold text-base leading-tight text-center active:bg-leaf-100 cursor-pointer';
    if (f.busy) return `<div class="flex items-center justify-center min-h-56 rounded-3xl bg-white border-2 border-leaf-100 font-display font-bold text-2xl" role="status">Préparation de la photo…</div>${inputs}`;
    if (!src) return `
      <label for="cam" id="f-photo" tabindex="-1" class="flex flex-col items-center justify-center gap-3 min-h-56 rounded-3xl border-4 border-dashed border-leaf-600 bg-white text-leaf-700 font-display font-extrabold text-2xl text-center p-6 cursor-pointer active:bg-leaf-100">${ICON.camera('w-16 h-16')}Prendre une photo</label>
      <p class="mt-3 text-center"><label for="gal" class="inline-flex items-center min-h-12 px-3 underline underline-offset-4 font-semibold cursor-pointer">Ou choisir dans la galerie</label></p>${inputs}`;
    return `
      <div class="relative rounded-3xl overflow-hidden bg-leaf-50 aspect-[4/3] border-2 border-leaf-100">${remoteImg(src, 'w-full h-full object-contain', 'Photo de la plante')}</div>
      ${f.main ? `<p class="mt-2 text-slate-700">${f.main.crop ? (hasAdj(f.main.crop.adj) ? 'Photo retouchée. ' : 'Photo recadrée. ') : ''}Elle est préparée automatiquement quand vous publiez.</p>` : ''}
      <div class="mt-3 grid grid-cols-3 gap-3">${f.main ? `<button type="button" data-act="crop" class="${btn}">${ICON.crop}<span>Retoucher</span></button>` : `<button type="button" data-act="edit-main" class="${btn}">${ICON.crop}<span>Retoucher</span></button>`}<label for="cam" class="${btn}">${ICON.camera('w-6 h-6')}<span>Reprendre</span></label><label for="gal" class="${btn}">${ICON.gallery()}<span>Galerie</span></label></div>${inputs}`;
  }

  /* ----- Doublons : même nom (sans accents, majuscules ni pluriel) dans la même catégorie, parmi MES plantes ----- */
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').map((w) => (w.length > 3 ? w.replace(/[sx]$/, '') : w)).join(' ');
  const ownDuplicate = (titre, categorie, exceptId) => {
    const n = norm(titre); if (!n) return null;
    return state.plantes.find((p) => p.id !== exceptId && p.categorie === categorie && norm(p.titre) === n) || null;
  };
  // Seul un nouveau nom ou une nouvelle catégorie peut créer un doublon (pas la simple modification d'un prix)
  const nameChanged = (f) => !f.id || typeof f.id === 'string' || f.titre.trim() !== f.origTitre || f.categorie !== f.origCat;
  function updateDupHint() {
    const f = state.form, el = $('#dup-hint'); if (!el) return;
    const dup = f.categorie && nameChanged(f) ? ownDuplicate(f.titre, f.categorie, f.id) : null;
    if (!dup) { el.classList.add('hidden'); return; }
    el.innerHTML = `Vous avez déjà « ${esc(dup.titre)} » dans cette catégorie. <a href="#/plante/${dup.id}" class="underline font-bold">Modifier celle-ci</a>`;
    el.classList.remove('hidden');
  }
  // Fenêtre de choix : 'voir' (modifier la plante existante), 'creer' (variété différente) ou 'annuler'
  function askDuplicate(dup) {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Cette plante existe déjà');
      ov.className = 'fixed inset-0 z-[70] bg-leaf-900/90 flex items-end justify-center p-4';
      ov.innerHTML = `<div class="w-full max-w-md rounded-3xl bg-white text-leaf-900 p-5 space-y-3">
        <h2 class="font-display font-extrabold text-2xl">Cette plante existe déjà</h2>
        <p class="text-lg">Vous avez déjà « <strong>${esc(dup.titre)}</strong> » dans cette catégorie${dup.statut === 'publish' ? ' (en ligne)' : dup.statut ? ' (brouillon)' : ''}. Pour éviter un doublon, modifiez-la plutôt que d’en créer une seconde.</p>
        ${dup.id ? `<button type="button" data-r="voir" class="w-full min-h-14 rounded-full bg-carrot text-leaf-900 font-display font-extrabold text-xl">Modifier « ${esc(dup.titre)} »</button>` : ''}
        <button type="button" data-r="creer" class="w-full min-h-14 rounded-full border-2 border-leaf-900 font-display font-bold text-lg">C’est une autre variété : créer quand même</button>
        <button type="button" data-r="annuler" class="w-full min-h-12 font-semibold underline underline-offset-4">Annuler</button></div>`;
      const close = (r) => { window.removeEventListener('keydown', onKey); ov.remove(); resolve(r); };
      const onKey = (e) => { if (e.key === 'Escape') close('annuler'); };
      window.addEventListener('keydown', onKey);
      ov.addEventListener('click', (e) => { const r = e.target.closest('[data-r]')?.dataset.r; if (r) close(r); });
      document.body.appendChild(ov); ov.querySelector('[data-r]').focus();
    });
  }

  /* ----- Identification de la plante (façon Google Lens) ----- */
  const CONF = { forte: 'Très probable', moyenne: 'Probable', faible: 'Possible' };
  function identBlock() {
    const f = state.form, st = f.ident || { status: 'idle' };
    if (!state.config?.ia || !f.main) return '';
    const btn = (label) => `<button type="button" data-act="identify" class="w-full flex items-center justify-center gap-2.5 min-h-14 rounded-2xl border-2 border-leaf-900 bg-white text-leaf-900 font-display font-bold text-xl active:bg-leaf-100">${ICON.spark}${label}</button>`;
    if (st.status === 'loading') return `<p role="status" class="rounded-2xl bg-leaf-50 border-2 border-leaf-100 px-4 py-4 font-display font-bold text-xl">L’assistant regarde votre photo…</p>`;
    if (st.status === 'error') return `<p role="status" class="rounded-2xl bg-sun-soft px-4 py-3 font-semibold">${esc(st.message)}</p><div class="mt-3">${btn('Réessayer')}</div>`;
    if (st.status === 'done') {
      const list = st.suggestions.length ? `
        <p class="font-display font-bold text-xl">Cette plante ressemble à :</p>
        <ul class="mt-2 space-y-2">${st.suggestions.map((x, i) => `
          <li><button type="button" data-pick="${i}" aria-pressed="${st.picked === i}" class="w-full text-left rounded-2xl border-2 px-4 py-3 min-h-16 ${st.picked === i ? 'bg-leaf-900 text-white border-leaf-900' : 'bg-white border-leaf-600'}">
            <span class="flex items-center justify-between gap-3"><span class="font-display font-extrabold text-2xl">${esc(x.nom)}</span><span class="shrink-0 text-sm font-bold rounded-full px-2.5 py-0.5 ${st.picked === i ? 'bg-white text-leaf-900' : 'bg-leaf-100 text-leaf-900'}">${CONF[x.confiance] || 'Possible'}</span></span>
            ${x.nom_scientifique ? `<span class="block text-base italic ${st.picked === i ? 'text-leaf-100' : 'text-slate-700'}">${esc(x.nom_scientifique)}</span>` : ''}
            ${x.nom_wolof ? `<span class="block text-base ${st.picked === i ? 'text-leaf-100' : 'text-slate-700'}">En wolof : <strong>${esc(x.nom_wolof)}</strong> (à vérifier)</span>` : ''}
          </button></li>`).join('')}</ul>
        ${fillBlock(st)}${wolofBlock(st)}
        <p class="mt-2 text-base text-slate-700">${st.picked == null ? 'Suggestion de l’assistant : touchez le bon nom, ou saisissez-le vous-même ci-dessous.' : 'Nom validé et rempli ci-dessous. Vous pouvez le modifier.'}</p>`
        : `<p class="font-semibold">Pas de suggestion pour cette photo.</p>`;
      return `${list}${st.remarque ? `<p role="status" class="mt-3 rounded-2xl bg-sun-soft px-4 py-3 font-semibold">${esc(st.remarque)}</p>` : ''}<div class="mt-3">${btn('Identifier à nouveau')}</div>`;
    }
    return `${btn('Identifier la plante')}<p class="mt-2 text-base text-slate-700">Une photo nette des feuilles aide l’assistant à trouver le nom.</p>`;
  }
  // Résumé de ce que le choix du nom a rempli tout seul, avec la possibilité de tout défaire
  function fillBlock(st) {
    const f = state.form, fl = st.fill; if (!fl) return '';
    const cfg = state.config, cat = cfg.univers.find((u) => u.slug === f.categorie), unit = cfg.conditionnements.find((u) => u.valeur === f.conditionnement);
    const row = (icon, t) => `<li class="flex gap-2"><span aria-hidden="true">${icon}</span><span>${t}</span></li>`;
    const rows = [row('✅', `Nom : <strong>${esc(f.titre)}</strong>`)];
    if (fl.filled.includes('categorie') && cat) rows.push(row('✅', `Catégorie : <strong>${esc(cat.label)}</strong>`));
    if (fl.filled.includes('conditionnement') && unit) rows.push(row('✅', `Vendu en : <strong>${esc(unit.label)}</strong>`));
    if (fl.busy) rows.push(row('⏳', 'L’assistant rédige la description et les conseils…'));
    else if (fl.filled.includes('description')) rows.push(row('✅', 'Description' + (fl.filled.includes('conseils') ? ' et conseils d’entretien' : '') + ' rédigées'));
    return `<div class="mt-3 rounded-2xl bg-leaf-50 border-2 border-leaf-600 p-4">
      <p class="font-display font-bold text-xl">✨ Fiche préremplie</p>
      <ul class="mt-2 space-y-1 text-lg" role="status">${rows.join('')}</ul>
      <p class="mt-2 text-base text-slate-700">Relisez chaque champ, puis indiquez le prix.</p>
      ${!fl.busy && fl.filled.length ? `<button type="button" data-act="undo-fill" class="mt-2 min-h-11 px-4 rounded-full border-2 border-leaf-900 bg-white text-leaf-900 font-bold">Annuler le préremplissage</button>` : ''}
    </div>`;
  }
  function undoFill() {
    const f = state.form, st = f.ident, fl = st?.fill; if (!fl) return;
    const radios = (name, v) => document.querySelectorAll(`input[name="${name}"]`).forEach((r) => { r.checked = r.value === v; });
    // on ne défait que ce que l'assistant a rempli et que l'agriculteur n'a pas retouché depuis
    const same = (k) => fl.filled.includes(k) && f[k] === fl.vals[k];
    if (same('categorie')) { f.categorie = fl.prev.categorie; radios('categorie', f.categorie); }
    if (same('conditionnement')) { f.conditionnement = fl.prev.conditionnement; radios('conditionnement', f.conditionnement); }
    if (same('description')) { f.description = fl.prev.description; $('#f-desc').value = f.description; }
    if (same('conseils')) { f.conseils = fl.prev.conseils; $('#f-conseils').value = f.conseils; }
    st.fill = null; renderIdent(); updateDupHint(); renderPriceHint();
  }

  // Prix habituel de ses autres plantes de la même catégorie (calculé sur ses propres fiches : l'assistant n'invente jamais de prix)
  function renderPriceHint() {
    const el = $('#prix-hint'), f = state.form; if (!el || !f) return;
    const xs = f.prix || !f.categorie ? [] : state.plantes.filter((p) => p.id !== f.id && p.categorie === f.categorie && p.prix > 0).map((p) => p.prix).sort((a, b) => a - b);
    const m = xs[Math.floor(xs.length / 2)];
    el.classList.toggle('hidden', !xs.length);
    el.innerHTML = xs.length ? `Vos ${xs.length === 1 ? 'autre plante' : xs.length + ' autres plantes'} de cette catégorie ${xs.length === 1 ? 'coûte' : 'coûtent'} en général <strong>${fcfa(m)} FCFA</strong>.
      <button type="button" data-act="use-price" data-price="${m}" class="mt-2 block min-h-11 px-4 rounded-full border-2 border-leaf-900 bg-white text-leaf-900 font-bold">Mettre ${fcfa(m)} FCFA</button>` : '';
  }

  // Le nom wolof proposé par l'assistant n'est enregistré que si l'agriculteur le valide
  function wolofBlock(st) {
    const x = st.picked != null ? st.suggestions[st.picked] : null;
    if (!x?.nom_wolof) return '';
    if (st.wolof === 'ok') return `<p role="status" class="mt-3 rounded-2xl bg-leaf-100 px-4 py-3 font-semibold">Nom wolof « ${esc(x.nom_wolof)} » validé et rempli ci-dessous.</p>`;
    if (st.wolof === 'no') return '';
    return `<div class="mt-3 rounded-2xl border-2 border-sun bg-sun-soft/40 p-4">
      <p class="font-display font-bold text-xl">Nom wolof proposé : « ${esc(x.nom_wolof)} »</p>
      <p class="mt-1 text-base text-slate-700">L’assistant peut se tromper sur les noms wolof. Est-ce le bon nom&nbsp;?</p>
      <div class="mt-3 grid grid-cols-2 gap-3">
        <button type="button" data-wolof="ok" class="min-h-14 rounded-full bg-leaf-900 text-white font-display font-bold text-lg">Oui, valider</button>
        <button type="button" data-wolof="no" class="min-h-14 rounded-full border-2 border-leaf-900 bg-white text-leaf-900 font-display font-bold text-lg">Non</button>
      </div></div>`;
  }
  function answerWolof(ok) {
    const f = state.form, st = f.ident, x = st?.suggestions?.[st.picked]; if (!x?.nom_wolof) return;
    if (ok) {
      if (f.nom_local.trim() && f.nom_local.trim() !== x.nom_wolof && !confirm(`Remplacer « ${f.nom_local.trim()} » par « ${x.nom_wolof} » ?`)) return;
      f.nom_local = x.nom_wolof; $('#f-local').value = x.nom_wolof;
    }
    st.wolof = ok ? 'ok' : 'no'; renderIdent();
  }
  const renderIdent = () => { const el = $('#ident'); if (el) el.innerHTML = identBlock(); };

  async function identify() {
    const f = state.form; if (!f?.main) return;
    if (!navigator.onLine) { f.ident = { status: 'error', message: 'Hors connexion : l’identification a besoin du réseau. Saisissez le nom vous-même.' }; return renderIdent(); }
    f.ident = { status: 'loading' }; renderIdent();
    try {
      const light = await lightBlob(f.main);
      const fd = new FormData(); fd.append('photo', light, 'plante.' + ext(light));
      fd.append('univers', JSON.stringify(state.config.univers.map((u) => [u.slug, u.label])));
      fd.append('conditionnements', JSON.stringify(state.config.conditionnements.map((u) => [u.valeur, u.label])));
      const out = await upload('/ia/identifier', fd, () => {});
      f.ident = { status: 'done', suggestions: out.suggestions || [], remarque: out.remarque || '' };
    } catch (e) {
      if (e.code === 'session') return sessionLost();
      f.ident = { status: 'error', message: e.message };
    }
    if (state.form === f) renderIdent();   // l'agriculteur a pu quitter l'écran entre-temps
  }
  async function pickSuggestion(i) {
    const f = state.form, st = f.ident, x = st?.suggestions?.[i]; if (!x) return;
    if (f.titre.trim() && f.titre.trim() !== x.nom && !confirm(`Remplacer « ${f.titre.trim()} » par « ${x.nom} » ?`)) return;
    f.titre = x.nom; $('#f-titre').value = x.nom; st.picked = i; st.wolof = undefined;
    // Le nom validé remplit le reste de la fiche, sans écraser ce que l'agriculteur a déjà choisi ou écrit
    const cfg = state.config, filled = [], prev = { categorie: f.categorie, conditionnement: f.conditionnement, description: f.description, conseils: f.conseils };
    const radios = (name, v) => document.querySelectorAll(`input[name="${name}"]`).forEach((r) => { r.checked = r.value === v; });
    if (!f.categorie && cfg.univers.some((u) => u.slug === x.categorie)) { f.categorie = x.categorie; radios('categorie', f.categorie); filled.push('categorie'); }
    if (!f.conditionnement && cfg.conditionnements.some((u) => u.valeur === x.conditionnement)) { f.conditionnement = x.conditionnement; radios('conditionnement', f.conditionnement); filled.push('conditionnement'); }
    const auto = cfg.ia && navigator.onLine && !f.description.trim();
    st.fill = { prev, filled, busy: auto, vals: { categorie: f.categorie, conditionnement: f.conditionnement } };
    renderIdent(); updateDupHint(); renderPriceHint();
    if (!auto) return;
    const conseilsAvant = f.conseils;
    const out = await describe();
    if (state.form !== f || f.ident !== st || st.picked !== i) return;   // l'agriculteur a changé de photo ou de choix entre-temps
    if (out) {
      st.fill.filled.push('description'); st.fill.vals.description = f.description;
      if (f.conseils !== conseilsAvant) { st.fill.filled.push('conseils'); st.fill.vals.conseils = f.conseils; }
    }
    st.fill.busy = false; renderIdent();
  }

  /* ----- Photos supplémentaires : la principale + 4 au maximum ----- */
  const extraSlots = () => 4 - state.form.gallery.length - state.form.extras.length;
  function extrasBlock() {
    const f = state.form, slots = extraSlots();
    const thumb = (url, rm, crop = null, gal = null) => `<div class="relative aspect-square rounded-2xl overflow-hidden bg-leaf-50 border-2 border-leaf-100">${crop !== null || gal !== null ? `<button type="button" ${crop !== null ? `data-crop="${crop}"` : `data-editgal="${gal}"`} aria-label="Retoucher cette photo" class="block w-full h-full">${remoteImg(url, 'w-full h-full object-cover')}</button><span class="pointer-events-none absolute bottom-1 left-1 rounded-full bg-white/95 text-leaf-900 px-2 py-0.5 text-sm font-bold">Retoucher</span>` : remoteImg(url, 'w-full h-full object-cover')}
      <button type="button" data-rm="${rm}" aria-label="Retirer cette photo" class="absolute top-1 right-1 w-11 h-11 rounded-full bg-white/95 text-leaf-900 font-extrabold text-xl shadow">✕</button></div>`;
    const tile = 'flex flex-col items-center justify-center gap-1 aspect-square rounded-2xl border-4 border-dashed border-leaf-600 bg-white text-leaf-700 font-display font-bold text-center cursor-pointer active:bg-leaf-100';
    const inputs = `<input id="xcam" type="file" accept="image/*" capture="environment" class="sr-only"><input id="xgal" type="file" accept="image/*" multiple class="sr-only">`;
    if (f.xbusy) return `<p role="status" class="rounded-2xl bg-white border-2 border-leaf-100 px-4 py-6 text-center font-display font-bold text-xl">Préparation des photos…</p>${inputs}`;
    return `<div class="grid grid-cols-3 gap-3">
      ${f.gallery.map((g) => thumb(g.url, 'gal:' + g.id, null, g.id)).join('')}${f.extras.map((x, i) => thumb(shown(x), 'new:' + i, i)).join('')}
      ${slots > 0 ? `<label for="xcam" class="${tile}">${ICON.camera('w-8 h-8')}<span class="text-base">Photo</span></label><label for="xgal" class="${tile}">${ICON.gallery('w-8 h-8')}<span class="text-base">Galerie</span></label>` : ''}
    </div>${inputs}`;
  }
  const renderExtras = () => { const el = $('#extras'); if (el) el.innerHTML = extrasBlock(); };

  function viewForm(id) {
    state.view = 'form';
    const e = id ? state.plantes.find((p) => p.id === id) : null;
    if (id && !e) { location.hash = ''; return; }
    if (state.form?.id !== (id || null) || state.form?.done) {
      const q = e ? entryFor(e) : null; // enregistrement en attente pour cette plante : on reprend sa photo
      state.form = {
        origTitre: e?.titre || '', origCat: e?.categorie || '', forceDup: false,
        id: id || null, titre: e?.titre || '', nom_local: e?.nom_local || '', categorie: e?.categorie || '', prix: e?.prix ? String(e.prix) : '', conditionnement: e?.conditionnement || '',
        disponible: e ? e.disponible : true, description: e?.description || '', conseils: e?.conseils || '', statut: e?.statut || 'draft',
        photoUrl: q?.blob ? '' : (e?.photo || ''), photoFull: q?.blob ? '' : (e?.photo_full || ''), main: q?.blob ? mkPhoto(q.blob, q.blob) : null, busy: false,
        // photos supplémentaires : déjà en ligne (gallery, moins celles à retirer), nouvelles (extras) et à retirer (removed)
        removed: q?.retirer ? [...q.retirer] : [],
        extras: (q?.extras || []).map((b) => mkPhoto(b, b)), xbusy: false, ident: null,
      };
      state.form.gallery = (e?.galerie || []).filter((g) => !state.form.removed.includes(g.id));
    }
    const f = state.form, cfg = state.config, published = f.statut === 'publish';
    const lab = 'block font-display font-bold text-xl mb-2';
    app.innerHTML = `
    ${banner()}
    <header class="sticky top-0 z-30 bg-leaf-900 text-white px-3 pt-[max(.75rem,env(safe-area-inset-top))] pb-3 flex items-center gap-2">
      <a href="#/" class="shrink-0 w-12 h-12 inline-flex items-center justify-center rounded-full border-2 border-white/40" aria-label="Retour à mes plantes">${ICON.back}</a>
      <h1 class="font-display font-extrabold text-2xl truncate">${id ? 'Modifier la plante' : 'Nouvelle plante'}</h1>
    </header>
    <form id="plant" class="px-4 pt-5 pb-48 space-y-7" novalidate>
      <p id="err" role="alert" tabindex="-1" class="${e?.erreur ? '' : 'hidden'} rounded-2xl bg-carrot text-leaf-900 font-bold px-4 py-3">${e?.erreur ? 'Le serveur a refusé cet enregistrement : ' + esc(e.erreur) : ''}</p>

      <section aria-labelledby="l-photo"><h2 id="l-photo" class="${lab}">Photo de la plante</h2><div id="photo">${photoBlock()}</div><div id="ident" class="mt-4">${identBlock()}</div></section>

      <section aria-labelledby="l-extras"><h2 id="l-extras" class="${lab}">Autres photos <span class="text-base font-normal text-slate-700">(4 au maximum)</span></h2><div id="extras">${extrasBlock()}</div></section>

      <section><label for="f-titre" class="${lab}">Nom de la plante</label>
        <input id="f-titre" value="${esc(f.titre)}" maxlength="80" autocomplete="off" enterkeyhint="next" placeholder="Menthe, manguier, basilic…" class="w-full h-16 rounded-2xl border-2 border-leaf-100 bg-white px-4 text-xl focus:outline-none focus:border-leaf-600 focus:ring-4 focus:ring-carrot/60">
        <p id="dup-hint" role="status" class="hidden mt-2 rounded-2xl bg-sun-soft px-4 py-3 font-semibold"></p></section>

      <section><label for="f-local" class="${lab}">Nom local (wolof)</label>
        <input id="f-local" value="${esc(f.nom_local)}" maxlength="80" autocomplete="off" enterkeyhint="next" placeholder="Facultatif" class="w-full h-16 rounded-2xl border-2 border-leaf-100 bg-white px-4 text-xl focus:outline-none focus:border-leaf-600 focus:ring-4 focus:ring-carrot/60">
        <p class="mt-1.5 text-slate-700 text-base">Le nom que vos clients utilisent. Ils pourront le chercher dans la boutique.</p></section>

      <section><h2 id="f-categorie" tabindex="-1" class="${lab}">Catégorie</h2>
        <div class="grid grid-cols-2 gap-3" role="radiogroup" aria-labelledby="f-categorie">
          ${cfg.univers.map((u) => `<label class="cursor-pointer"><input type="radio" name="categorie" value="${esc(u.slug)}" class="peer sr-only" ${f.categorie === u.slug ? 'checked' : ''}>
            <span class="flex flex-col items-center justify-center gap-1 min-h-24 rounded-2xl border-2 border-leaf-100 bg-white font-bold text-center p-2 peer-checked:bg-leaf-900 peer-checked:text-white peer-checked:border-leaf-900 peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-carrot"><span class="text-3xl" aria-hidden="true">${esc(u.icone)}</span>${esc(u.label)}</span></label>`).join('')}
        </div></section>

      <section><label for="f-prix" class="${lab}">Prix</label>
        <div class="flex items-center gap-3"><input id="f-prix" inputmode="numeric" pattern="[0-9]*" value="${esc(f.prix)}" maxlength="8" placeholder="1500" enterkeyhint="next" class="min-w-0 flex-1 h-16 rounded-2xl border-2 border-leaf-100 bg-white px-4 text-2xl font-display font-bold tabular-nums focus:outline-none focus:border-leaf-600 focus:ring-4 focus:ring-carrot/60"><span class="font-display font-bold text-xl">FCFA</span></div>
        <p class="mt-1.5 text-slate-700 text-base">Laissez vide pour « prix sur demande ».</p>
        <p id="prix-hint" role="status" class="hidden mt-2 rounded-2xl bg-leaf-50 px-4 py-3 text-lg"></p></section>

      <section><h2 class="${lab}">Vendu en</h2>
        <div class="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Conditionnement">${cfg.conditionnements.map((u) => pill('conditionnement', u.valeur, u.label, f.conditionnement === u.valeur)).join('')}</div></section>

      <section><label class="flex items-center justify-between gap-4 min-h-16 rounded-2xl bg-white border-2 border-leaf-100 px-4 cursor-pointer">
        <span class="font-display font-bold text-xl">Disponible à la vente</span>
        <input type="checkbox" id="f-dispo" class="peer sr-only" ${f.disponible ? 'checked' : ''}>
        <span class="switch peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-carrot" aria-hidden="true"></span></label></section>

      <section><label for="f-desc" class="${lab}">Description</label>
        ${cfg.ia ? `
        <div class="mb-3">
          <button type="button" id="ia" class="w-full flex items-center justify-center gap-2.5 min-h-14 rounded-2xl border-2 border-leaf-900 bg-white text-leaf-900 font-display font-bold text-xl active:bg-leaf-100 disabled:opacity-60">${ICON.spark}<span id="ia-label">Décrire avec l’assistant</span></button>
          <p id="ia-note" role="status" class="mt-2 text-base text-slate-700">Il lit votre photo et le nom, puis propose un texte que vous corrigez.</p>
          <p id="ia-warn" role="status" class="hidden mt-2 rounded-2xl bg-sun-soft px-4 py-3 font-semibold"></p>
        </div>` : ''}
        <textarea id="f-desc" rows="4" maxlength="1500" placeholder="Variété, taille, état des plants…" class="w-full rounded-2xl border-2 border-leaf-100 bg-white p-4 text-xl leading-snug focus:outline-none focus:border-leaf-600 focus:ring-4 focus:ring-carrot/60">${esc(f.description)}</textarea>
        ${dictBtn('f-desc')}</section>

      <details class="rounded-2xl bg-white border-2 border-leaf-100" ${f.conseils ? 'open' : ''}>
        <summary class="min-h-16 px-4 flex items-center font-display font-bold text-xl cursor-pointer">Conseils d’entretien (facultatif)</summary>
        <div class="px-4 pb-4"><textarea id="f-conseils" rows="3" maxlength="1000" placeholder="Arrosage, soleil, quand récolter…" class="w-full rounded-2xl border-2 border-leaf-100 bg-leaf-50 p-4 text-xl leading-snug focus:outline-none focus:border-leaf-600 focus:ring-4 focus:ring-carrot/60">${esc(f.conseils)}</textarea>
          ${dictBtn('f-conseils')}</div>
      </details>

      ${id ? `<p class="pt-2 text-center"><button type="button" data-act="remove" class="min-h-12 px-4 font-bold text-red-800 underline underline-offset-4">${typeof id === 'string' ? 'Supprimer cet enregistrement' : 'Retirer cette plante'}</button></p>` : ''}
    </form>

    <div class="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t-2 border-leaf-100 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] grid ${published ? 'grid-cols-1' : 'grid-cols-2'} gap-3">
      ${published
        ? `<button type="button" data-save="publish" class="min-h-16 rounded-full bg-carrot text-leaf-900 font-display font-extrabold text-2xl shadow-[0_5px_0_rgba(0,0,0,.2)] active:translate-y-[3px] active:shadow-none">Enregistrer</button>`
        : `<button type="button" data-save="draft" class="min-h-16 rounded-full border-2 border-leaf-900 font-display font-bold text-xl active:bg-leaf-100">Brouillon</button>
           <button type="button" data-save="publish" class="min-h-16 rounded-full bg-carrot text-leaf-900 font-display font-extrabold text-2xl shadow-[0_5px_0_rgba(0,0,0,.2)] active:translate-y-[3px] active:shadow-none">Publier</button>`}
    </div>
    <div id="busy" class="hidden fixed inset-0 z-50 bg-leaf-900/90 text-white flex flex-col items-center justify-center gap-5 p-8 text-center" role="alert">
      <p class="font-display font-extrabold text-3xl" id="busy-text">Envoi en cours…</p>
      <div class="w-full max-w-xs h-4 rounded-full bg-white/20 overflow-hidden"><div id="bar" class="h-full w-0 bg-carrot transition-[width]"></div></div>
    </div>`;
    bindForm();
  }

  const dictBtn = (id) => (SR ? `<button type="button" data-dictee="${id}" aria-pressed="false" class="mt-2 w-full flex items-center justify-center gap-2.5 min-h-14 rounded-2xl border-2 border-leaf-900 bg-white text-leaf-900 font-display font-bold text-xl active:bg-leaf-100">${ICON.mic}<span>Dicter</span></button>
        <p data-dnote="${id}" role="status" class="mt-1 text-base text-slate-700"></p>` : '');

  function bindForm() {
    const f = state.form, form = $('#plant');
    const text = (id, key) => $(id).addEventListener('input', (e) => { f[key] = e.target.value; });
    text('#f-titre', 'titre'); $('#f-titre').addEventListener('input', updateDupHint); text('#f-local', 'nom_local'); text('#f-desc', 'description'); text('#f-conseils', 'conseils');
    $('#f-prix').addEventListener('input', (e) => { e.target.value = f.prix = e.target.value.replace(/\D/g, ''); renderPriceHint(); });
    $('#f-dispo').addEventListener('change', (e) => { f.disponible = e.target.checked; });
    form.addEventListener('change', (e) => { if (e.target.name === 'categorie') { f.categorie = e.target.value; updateDupHint(); renderPriceHint(); } if (e.target.name === 'conditionnement') f.conditionnement = e.target.value; });
    // Les champs « photo » sont recréés avec le bloc : on écoute au niveau du formulaire
    form.addEventListener('change', async (e) => {
      if (e.target.id !== 'cam' && e.target.id !== 'gal') return;
      const file = e.target.files?.[0]; if (!file) return;
      // la photo est gardée telle quelle : recadrage possible, traitement automatique à la publication
      dropPhoto(f.main); f.main = mkPhoto(file); f.ident = null;
      $('#photo').innerHTML = photoBlock(); renderIdent();
      // comme Google Lens : une nouvelle photo et pas encore de nom → l'assistant propose des noms tout seul
      if (state.config?.ia && navigator.onLine && !f.titre.trim() && !f.id) identify();
    });
    // Photos supplémentaires (une à la fois avec l'appareil, plusieurs d'un coup depuis la galerie), 4 au maximum
    form.addEventListener('change', async (e) => {
      if (e.target.id !== 'xcam' && e.target.id !== 'xgal') return;
      const files = [...(e.target.files || [])].slice(0, Math.max(0, extraSlots())); if (!files.length) return;
      for (const file of files) f.extras.push(mkPhoto(file));
      renderExtras();
    });
    form.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]')?.dataset.rm;
      if (rm) {
        const [kind, v] = rm.split(':');
        if (kind === 'gal') { f.removed.push(Number(v)); f.gallery = f.gallery.filter((g) => g.id !== Number(v)); }
        else { const [x] = f.extras.splice(Number(v), 1); dropPhoto(x); }
        renderExtras();
      }
      const dc = e.target.closest('[data-dictee]'); if (dc) startDictation(dc.dataset.dictee);
      if (e.target.closest('[data-act="identify"]')) identify();
      if (e.target.closest('[data-act="crop"]') && f.main) cropPhoto(f.main);
      if (e.target.closest('[data-act="edit-main"]')) editOnline('main');
      const eg = e.target.closest('[data-editgal]'); if (eg) editOnline('gal', Number(eg.dataset.editgal));
      const cr = e.target.closest('[data-crop]'); if (cr && f.extras[Number(cr.dataset.crop)]) cropPhoto(f.extras[Number(cr.dataset.crop)]);
      const pick = e.target.closest('[data-pick]'); if (pick) pickSuggestion(Number(pick.dataset.pick));
      const wo = e.target.closest('[data-wolof]'); if (wo) answerWolof(wo.dataset.wolof === 'ok');
      if (e.target.closest('[data-act="undo-fill"]')) undoFill();
      const up = e.target.closest('[data-act="use-price"]'); if (up) { f.prix = up.dataset.price; $('#f-prix').value = f.prix; renderPriceHint(); }
    });
    $('#ia')?.addEventListener('click', describe);
    updateDupHint(); renderPriceHint();
    document.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', () => save(b.dataset.save)));
  }

  function fail(msg, focusId) {
    const el = $('#err'); if (!el) return toast(msg, 'err');
    el.textContent = msg; el.classList.remove('hidden');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true });
    if (focusId) setTimeout(() => $('#' + focusId)?.focus({ preventScroll: true }), 350);
  }
  const busy = (on, pct = 0, label) => {
    const o = $('#busy'); if (!o) return;
    o.classList.toggle('hidden', !on);
    if (on) { $('#bar').style.width = pct + '%'; $('#busy-text').textContent = label || (pct >= 100 ? 'Enregistrement…' : `Envoi en cours… ${pct} %`); }
  };

  async function save(statut) {
    stopDictation();
    const f = state.form; $('#err').classList.add('hidden');
    if (f.titre.trim().length < 2) return fail('Indiquez le nom de la plante.', 'f-titre');
    if (!f.categorie) return fail('Choisissez une catégorie.', 'f-categorie');
    if (statut === 'publish' && !f.main && !f.photoUrl) return fail('Ajoutez une photo avant de publier.', 'f-photo');
    const fields = {
      titre: f.titre.trim(), nom_local: f.nom_local.trim(), categorie: f.categorie, prix: f.prix || '0', conditionnement: f.conditionnement,
      disponible: f.disponible ? '1' : '0', description: f.description.trim(), conseils: f.conseils.trim(), statut,
      ...(f.forceDup ? { force: '1' } : {}),
    };
    // Doublon : on prévient avant tout traitement (aussi hors connexion, d'après les plantes déjà connues)
    if (!f.forceDup && nameChanged(f)) {
      const dup = ownDuplicate(f.titre, f.categorie, f.id);
      if (dup) {
        const r = await askDuplicate(dup);
        if (r === 'annuler') return;
        if (r === 'voir') { f.done = true; location.hash = '#/plante/' + dup.id; return; }
        f.forceDup = true; fields.force = '1';
      }
    }
    // Traitement automatique des photos au clic : recadrage, 1600 px, WebP, sans métadonnées. Fait une seule fois par photo.
    let mainBlob = null; const extraBlobs = [];
    busy(true, 0, 'Préparation des photos…');
    try {
      if (f.main) mainBlob = await finalBlob(f.main);
      for (const x of f.extras) extraBlobs.push(await finalBlob(x));
    } catch { busy(false); return fail('Une photo n’a pas pu être préparée. Essayez de la reprendre.'); }
    const isLocal = typeof f.id === 'string';
    const key = isLocal ? f.id : f.id ? 'u-' + f.id : 'c-' + uid();
    const entry = {
      key, type: isLocal || !f.id ? 'create' : 'update', plantId: isLocal || !f.id ? undefined : f.id,
      fields, blob: mainBlob, extras: extraBlobs, retirer: f.removed, user: state.me.id, createdAt: state.queue.find((q) => q.key === key)?.createdAt || Date.now(),
    };
    const done = (msg) => { dropPhoto(f.main); f.extras.forEach(dropPhoto); f.done = true; toast(msg); location.hash = '#/'; };

    if (navigator.onLine) {
      busy(true, 0);
      try {
        // le serveur a le dernier mot : s'il connaît déjà cette plante (autre téléphone, liste pas à jour), même choix
        const sendOnce = () => sendEntry(entry, (pct) => busy(true, pct));
        const saved = await sendOnce().catch(async (err) => {
          if (!(err.status === 409 && err.code === 'mbk_doublon') || entry.fields.force) throw err;
          busy(false);
          const ex = err.existant || {};
          const r = await askDuplicate({ id: ex.id, titre: ex.titre || f.titre, statut: ex.statut });
          if (r === 'voir' && ex.id) { f.done = true; location.hash = '#/plante/' + ex.id; }
          if (r !== 'creer') throw Object.assign(new Error('abandon'), { abandon: true });
          entry.fields.force = '1'; f.forceDup = true; busy(true, 0);
          return sendOnce();
        });
        await dequeue(key); mergeServer(saved); rebuild();
        cPut({ me: state.me, config: state.config, plantes: state.server }).catch(() => {});
        return done(statut === 'publish' ? (f.id && f.statut === 'publish' && !isLocal ? 'Modifications enregistrées' : 'Plante publiée') : 'Brouillon enregistré');
      } catch (e) {
        busy(false);
        if (e.abandon) return;
        if (e.code === 'session') { try { await enqueue(entry); } catch {} return sessionLost(); } // rien n'est perdu : envoyé après la reconnexion
        if (!isNetErr(e)) return fail(e.message);
        // réseau coupé en cours d'envoi : on garde l'enregistrement sur le téléphone
      }
    }
    try { await enqueue(entry); } catch (e) { busy(false); return fail(e.message); }
    done(statut === 'publish' ? 'Enregistré sur le téléphone. La plante sera publiée dès que le réseau revient.' : 'Brouillon gardé sur le téléphone. Il partira dès que le réseau revient.');
  }

  /* ----- Assistant : propose description et conseils (l'agriculteur relit toujours) ----- */
  async function describe() {
    stopDictation();
    const f = state.form, btn = $('#ia'), label = $('#ia-label'), note = $('#ia-note'), warn = $('#ia-warn');
    warn.classList.add('hidden');
    if (!navigator.onLine) { note.textContent = 'Hors connexion : l’assistant a besoin du réseau. Écrivez la description vous-même ou relancez-le plus tard.'; return; }
    if (f.titre.trim().length < 2) { note.textContent = 'Indiquez d’abord le nom de la plante.'; $('#f-titre').focus(); return; }
    const replacing = f.description.trim().length > 0;
    if (replacing && !confirm('Remplacer votre description par la proposition de l’assistant ?')) return;
    btn.disabled = true; label.textContent = 'L’assistant rédige…';
    note.textContent = f.main ? 'Il regarde votre photo.' : 'Sans photo, la description sera plus générale.';
    const fd = new FormData();
    fd.append('titre', f.titre.trim());
    const cat = state.config.univers.find((u) => u.slug === f.categorie), unit = state.config.conditionnements.find((u) => u.valeur === f.conditionnement);
    if (cat) fd.append('categorie_label', cat.label);
    if (unit) fd.append('conditionnement_label', unit.label);
    if (f.main) { try { const light = await lightBlob(f.main); fd.append('photo', light, 'plante.' + ext(light)); } catch {} }
    try {
      const out = await upload('/ia/description', fd, () => {});
      f.description = out.description; $('#f-desc').value = out.description;
      if (out.conseils && (replacing || !f.conseils.trim())) { f.conseils = out.conseils; const c = $('#f-conseils'); c.value = out.conseils; c.closest('details').open = true; }
      note.textContent = 'Proposition de l’assistant : relisez-la et corrigez-la avant de publier.';
      if (out.remarque) { warn.textContent = out.remarque; warn.classList.remove('hidden'); }
      label.textContent = 'Proposer une autre description';
      return out;
    } catch (e) {
      if (e.code === 'session') return sessionLost();
      note.textContent = e.message; label.textContent = 'Décrire avec l’assistant';
      return null;
    } finally { btn.disabled = false; }
  }

  /* ---------------- Actions de la liste ---------------- */
  async function setStock(id, on, input) {
    const p = state.plantes.find((x) => x.id === id); if (!p) return;
    const label = $(`[data-stock-label="${id}"]`); if (label) label.textContent = on ? 'En stock' : 'Épuisé';
    const val = on ? '1' : '0';
    const keep = async () => {
      // Hors connexion : la modification rejoint l'enregistrement en attente de cette plante, ou en crée un
      let e = entryFor(p);
      if (e && e.fields) { e.fields.disponible = val; await enqueue(e); }
      else await enqueue({ key: 's-' + id, type: 'stock', plantId: id, disponible: on, user: state.me.id, createdAt: Date.now() });
      toast('Enregistré sur le téléphone. Il partira dès que le réseau revient.');
      refreshView();
    };
    try {
      if (p.local) { const e = entryFor(p); e.fields.disponible = val; await enqueue(e); return; }
      if (!navigator.onLine) return await keep();
      const saved = await api(`/plantes/${id}/disponibilite`, { method: 'POST', json: { disponible: on } });
      mergeServer(saved); await dequeue('s-' + id); // une ancienne bascule en attente ne doit pas écraser celle-ci
      const e = entryFor(p); if (e?.fields) { e.fields.disponible = val; await enqueue(e); } else rebuild();
      toast(on ? `${p.titre} : en stock` : `${p.titre} : épuisé`);
    } catch (e) {
      if (isNetErr(e)) { try { await keep(); } catch (x) { input.checked = !on; if (label) label.textContent = !on ? 'En stock' : 'Épuisé'; toast(x.message, 'err'); } return; }
      input.checked = !on; if (label) label.textContent = !on ? 'En stock' : 'Épuisé';
      if (e.code === 'session') return sessionLost();
      toast(e.message, 'err');
    }
  }

  async function removePlant() {
    const f = state.form; if (!f?.id) return;
    if (typeof f.id === 'string') { // enregistrement pas encore parti : on l'abandonne simplement
      if (!confirm('Supprimer cet enregistrement du téléphone ?')) return;
      await dequeue(f.id); f.done = true; toast('Enregistrement supprimé'); location.hash = '#/'; return;
    }
    if (!navigator.onLine) return toast('Retirer une plante demande le réseau. Réessayez quand vous êtes connecté.', 'err');
    if (!confirm('Retirer cette plante de votre liste et de la boutique ?')) return;
    try {
      await api(`/plantes/${f.id}`, { method: 'DELETE' });
      state.server = state.server.filter((p) => p.id !== f.id);
      for (const e of state.queue.filter((q) => q.plantId === f.id)) await dequeue(e.key);
      rebuild(); f.done = true;
      toast('Plante retirée'); location.hash = '#/';
    } catch (e) { if (e.code === 'session') return sessionLost(); toast(e.message, 'err'); }
  }

  async function logout() {
    const n = state.queue.length;
    if (n && !confirm(`${n} ${plural(n, 'enregistrement attend', 'enregistrements attendent')} d’être envoyé. ${plural(n, 'Il restera', 'Ils resteront')} sur ce téléphone jusqu’à votre prochaine connexion. Quitter quand même ?`)) return;
    try { await api('/logout', { method: 'POST' }); } catch {}
    try { await cDel(); } catch {}
    try { await caches.delete('mbk-photos'); } catch {}   // la liste mémorisée ne doit pas rester lisible une fois déconnecté
    state.me = null; state.server = []; state.queue = []; state.plantes = []; state.form = null; location.hash = ''; viewLogin();
  }
  function sessionLost() { state.me = null; viewLogin('Votre session a expiré. Reconnectez-vous : vos enregistrements en attente sont gardés.'); }

  app.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (a?.dataset.act === 'logout') logout();
    if (a?.dataset.act === 'remove') removePlant();
    if (a?.dataset.act === 'flush') flush(true);
    const t = e.target.closest('[data-filter]'); if (t) { state.filter = t.dataset.filter; viewHome(); }
  });
  app.addEventListener('change', (e) => {
    const raw = e.target.dataset?.stock; if (raw === undefined) return;
    setStock(/^\d+$/.test(raw) ? Number(raw) : raw, e.target.checked, e.target);
  });

  /* ---------------- Démarrage ---------------- */
  function route() {
    stopDictation();
    if (!state.me) return;
    const h = location.hash.replace(/^#\/?/, '');
    window.scrollTo(0, 0);
    if (h === 'nouvelle') return viewForm(null);
    const m = h.match(/^plante\/([\w-]+)$/); if (m) return viewForm(/^\d+$/.test(m[1]) ? Number(m[1]) : m[1]);
    viewHome();
  }

  async function boot() {
    try {
      if (!state.me) state.me = await api('/session');
      const [config, { plantes }] = await Promise.all([api('/config'), api('/plantes')]);
      state.config = config; state.server = plantes; state.offline = false;
      if (hasIDB) cPut({ me: state.me, config, plantes }).catch(() => {});
    } catch (e) {
      if (e.status === 401 || e.status === 403) { state.me = null; return viewLogin(e.status === 403 ? e.message : ''); }
      // Pas de réseau : on ouvre avec la dernière liste connue, l'agriculteur peut quand même saisir
      const snap = isNetErr(e) && hasIDB ? await cGet().catch(() => null) : null;
      if (!snap) {
        app.innerHTML = `${banner()}<main class="min-h-screen flex flex-col items-center justify-center gap-5 p-8 text-center"><p class="font-display font-extrabold text-3xl">${esc(e.message)}</p><button class="min-h-14 px-8 rounded-full bg-leaf-900 text-white font-bold text-xl" onclick="location.reload()">Réessayer</button></main>`;
        return;
      }
      Object.assign(state, { me: snap.v.me, config: snap.v.config, server: snap.v.plantes, offline: true, snapAt: snap.at });
    }
    state.queue = hasIDB ? (await qAll().catch(() => [])).filter((q) => q.user === state.me.id) : [];
    rebuild(); route(); flush(); if (state.queue.length) requestBgSync();
    if (!state.offline) cachePhotos(state.server);
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('offline', () => { updateBanner(); refreshView(); });
  window.addEventListener('online', async () => {
    updateBanner(); if (!state.me) return;
    await flush(); if (!state.queue.length) await refreshServer();
    refreshView();
  });
  navigator.serviceWorker?.addEventListener('message', async (ev) => {
    if (ev.data?.type !== 'mbk-flushed' || !state.me) return;
    try { state.queue = hasIDB ? (await qAll()).filter((q) => q.user === state.me.id) : state.queue; } catch {}
    await refreshServer(); refreshView();
    toast(`${ev.data.sent} ${plural(ev.data.sent, 'enregistrement envoyé', 'enregistrements envoyés')} en arrière-plan`);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopDictation(); else flush(); });
  setInterval(() => { if (state.queue.length) flush(); }, 20000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/agriculteur/sw.js', { scope: '/agriculteur/' }).catch(() => {});
  boot();
})();
