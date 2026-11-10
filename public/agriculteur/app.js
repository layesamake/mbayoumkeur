// Espace agriculteur : application mobile (PWA) pour saisir ses plantes sur le terrain.
// Pensée pour le plein soleil et les mains sales : gros texte, grosses cibles, actions en bas de l'écran.
(() => {
  'use strict';
  const app = document.getElementById('app');
  const toastBox = document.getElementById('toast');
  const state = { me: null, config: null, plantes: [], filter: 'tout', form: null };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(n);
  const plural = (n, a, b) => (n > 1 ? b : a);
  const $ = (sel, root = document) => root.querySelector(sel);

  const ICON = {
    camera: (c = 'w-8 h-8') => `<svg class="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.8"/></svg>`,
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
    if (!res.ok) throw Object.assign(new Error(data?.message || 'Erreur du serveur.'), { status: res.status, code: data?.code });
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
        else reject(Object.assign(new Error(data?.message || 'Erreur du serveur.'), { status: x.status, code: data?.code }));
      };
      x.send(form);
    });
  }

  function toast(msg, kind = 'ok') {
    const el = document.createElement('div');
    el.className = `mx-auto max-w-md rounded-2xl px-5 py-4 font-semibold shadow-[0_6px_0_rgba(0,0,0,.2)] ${kind === 'ok' ? 'bg-leaf-900 text-white' : 'bg-carrot text-leaf-900'}`;
    el.textContent = msg;
    toastBox.replaceChildren(el);
    setTimeout(() => el.remove(), 3800);
  }

  /* ---------------- Photo : réduite sur le téléphone avant l'envoi ---------------- */
  // 4 à 8 Mo en sortie d'appareil photo seraient trop lourds en 3G : on envoie ~200–400 Ko.
  // Le canvas redresse la photo et ne conserve aucune métadonnée (donc pas de position GPS).
  async function compress(file, max = 1600) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch {
      bmp = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(file); });
    }
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const to = (type, q) => new Promise((r) => c.toBlob(r, type, q));
    let blob = await to('image/webp', 0.8);
    if (!blob || blob.type !== 'image/webp') blob = await to('image/jpeg', 0.82); // Safari ne sait pas écrire en WebP
    return blob;
  }
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko');

  /* ---------------- Écrans ---------------- */
  const banner = () => (navigator.onLine ? '' : `<p role="status" class="bg-carrot text-leaf-900 font-bold text-center px-4 py-3">Hors connexion : vos plantes s’afficheront, mais l’envoi attendra le réseau.</p>`);

  function viewLogin(msg = '') {
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
    </main>`;
    const form = $('#login'), err = $('#err');
    $('#show').addEventListener('click', (e) => { const p = $('#p'); const on = p.type === 'password'; p.type = on ? 'text' : 'password'; e.currentTarget.textContent = on ? 'Cacher' : 'Voir'; e.currentTarget.setAttribute('aria-pressed', on); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button.w-full'); btn.disabled = true; btn.textContent = 'Connexion…'; err.classList.add('hidden');
      try {
        const out = await api('/login', { method: 'POST', json: { identifiant: $('#u').value.trim(), motdepasse: $('#p').value } });
        state.me = { nom: out.nom };
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
    return `
    <li class="bg-white rounded-3xl border-2 border-leaf-100 p-3 flex gap-3 items-stretch">
      <a href="#/plante/${p.id}" class="shrink-0 w-24 h-24 rounded-2xl overflow-hidden bg-leaf-50 flex items-center justify-center text-4xl" aria-label="Modifier ${esc(p.titre)}">
        ${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" class="w-full h-full object-cover ${p.disponible ? '' : 'opacity-50 grayscale'}">` : `<span aria-hidden="true">${icon(p.categorie)}</span>`}
      </a>
      <div class="flex-1 min-w-0 flex flex-col justify-between">
        <div>
          <a href="#/plante/${p.id}" class="block font-display font-bold text-xl leading-tight truncate">${esc(p.titre)}</a>
          <p class="text-slate-700">${p.prix ? fcfa(p.prix) + ' FCFA' + (p.conditionnement ? ' / ' + esc(UNIT(p.conditionnement)) : '') : 'Prix sur demande'}</p>
        </div>
        <span class="self-start rounded-full px-3 py-0.5 text-base font-bold ${online ? 'bg-leaf-100 text-leaf-900' : 'bg-sun-soft text-leaf-900'}">${online ? 'En ligne' : 'Brouillon'}</span>
      </div>
      <label class="shrink-0 flex flex-col items-center justify-center gap-1.5 w-20 cursor-pointer">
        <input type="checkbox" data-stock="${p.id}" class="peer sr-only" ${p.disponible ? 'checked' : ''}>
        <span class="switch peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-carrot" aria-hidden="true"></span>
        <span class="text-sm font-bold" data-stock-label="${p.id}">${p.disponible ? 'En stock' : 'Épuisé'}</span>
      </label>
    </li>`;
  }

  function viewHome() {
    const all = state.plantes;
    const on = all.filter((p) => p.statut === 'publish').length;
    const shown = all.filter((p) => state.filter === 'tout' || (state.filter === 'ligne' ? p.statut === 'publish' : p.statut !== 'publish'));
    const tab = (k, label) => `<button type="button" role="tab" aria-selected="${state.filter === k}" data-filter="${k}" class="min-h-12 rounded-xl font-bold ${state.filter === k ? 'bg-leaf-900 text-white' : 'text-leaf-900'}">${label}</button>`;
    app.innerHTML = `
    ${banner()}
    <header class="sticky top-0 z-30 bg-leaf-900 text-white px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-4">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0"><p class="text-leaf-100 text-base">Bonjour</p><h1 class="font-display font-extrabold text-3xl leading-none truncate">${esc(state.me.nom)}</h1></div>
        <button type="button" data-act="logout" class="shrink-0 min-h-12 px-5 rounded-full border-2 border-white/40 font-semibold">Quitter</button>
      </div>
      <p class="mt-3 text-leaf-100"><strong class="font-display text-white text-2xl">${all.length}</strong> ${plural(all.length, 'plante', 'plantes')}, dont <strong class="font-display text-white text-2xl">${on}</strong> en ligne</p>
    </header>
    <main class="px-4 pt-4 pb-36">
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
    const src = f.blob ? f.previewUrl : f.photoUrl;
    const inputs = `<input id="cam" type="file" accept="image/*" capture="environment" class="sr-only"><input id="gal" type="file" accept="image/*" class="sr-only">`;
    const btn = 'flex items-center justify-center gap-2 min-h-14 rounded-2xl border-2 border-leaf-900 font-bold text-lg active:bg-leaf-100 cursor-pointer';
    if (f.busy) return `<div class="flex items-center justify-center min-h-56 rounded-3xl bg-white border-2 border-leaf-100 font-display font-bold text-2xl" role="status">Préparation de la photo…</div>${inputs}`;
    if (!src) return `
      <label for="cam" id="f-photo" tabindex="-1" class="flex flex-col items-center justify-center gap-3 min-h-56 rounded-3xl border-4 border-dashed border-leaf-600 bg-white text-leaf-700 font-display font-extrabold text-2xl text-center p-6 cursor-pointer active:bg-leaf-100">${ICON.camera('w-16 h-16')}Prendre une photo</label>
      <p class="mt-3 text-center"><label for="gal" class="inline-flex items-center min-h-12 px-3 underline underline-offset-4 font-semibold cursor-pointer">Ou choisir dans la galerie</label></p>${inputs}`;
    return `
      <div class="relative rounded-3xl overflow-hidden bg-leaf-50 aspect-[4/3] border-2 border-leaf-100"><img src="${esc(src)}" alt="Photo de la plante" class="w-full h-full object-cover"></div>
      ${f.blob ? `<p class="mt-2 text-slate-700">Photo prête, ${esc(kb(f.blob.size))}.</p>` : ''}
      <div class="mt-3 grid grid-cols-2 gap-3"><label for="cam" class="${btn}">${ICON.camera('w-6 h-6')}Reprendre</label><label for="gal" class="${btn}">Galerie</label></div>${inputs}`;
  }

  function viewForm(id) {
    const e = id ? state.plantes.find((p) => p.id === id) : null;
    if (id && !e) { location.hash = ''; return; }
    if (state.form?.id !== (id || null) || state.form?.done) {
      state.form = {
        id: id || null, titre: e?.titre || '', categorie: e?.categorie || '', prix: e?.prix ? String(e.prix) : '', conditionnement: e?.conditionnement || '',
        disponible: e ? e.disponible : true, description: e?.description || '', conseils: e?.conseils || '', statut: e?.statut || 'draft',
        photoUrl: e?.photo || '', blob: null, previewUrl: '', busy: false,
      };
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
      <p id="err" role="alert" tabindex="-1" class="hidden rounded-2xl bg-carrot text-leaf-900 font-bold px-4 py-3"></p>

      <section aria-labelledby="l-photo"><h2 id="l-photo" class="${lab}">Photo de la plante</h2><div id="photo">${photoBlock()}</div></section>

      <section><label for="f-titre" class="${lab}">Nom de la plante</label>
        <input id="f-titre" value="${esc(f.titre)}" maxlength="80" autocomplete="off" enterkeyhint="next" placeholder="Menthe, manguier, basilic…" class="w-full h-16 rounded-2xl border-2 border-leaf-100 bg-white px-4 text-xl focus:outline-none focus:border-leaf-600 focus:ring-4 focus:ring-carrot/60"></section>

      <section><h2 id="f-categorie" tabindex="-1" class="${lab}">Catégorie</h2>
        <div class="grid grid-cols-2 gap-3" role="radiogroup" aria-labelledby="f-categorie">
          ${cfg.univers.map((u) => `<label class="cursor-pointer"><input type="radio" name="categorie" value="${esc(u.slug)}" class="peer sr-only" ${f.categorie === u.slug ? 'checked' : ''}>
            <span class="flex flex-col items-center justify-center gap-1 min-h-24 rounded-2xl border-2 border-leaf-100 bg-white font-bold text-center p-2 peer-checked:bg-leaf-900 peer-checked:text-white peer-checked:border-leaf-900 peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-carrot"><span class="text-3xl" aria-hidden="true">${esc(u.icone)}</span>${esc(u.label)}</span></label>`).join('')}
        </div></section>

      <section><label for="f-prix" class="${lab}">Prix</label>
        <div class="flex items-center gap-3"><input id="f-prix" inputmode="numeric" pattern="[0-9]*" value="${esc(f.prix)}" maxlength="8" placeholder="1500" enterkeyhint="next" class="min-w-0 flex-1 h-16 rounded-2xl border-2 border-leaf-100 bg-white px-4 text-2xl font-display font-bold tabular-nums focus:outline-none focus:border-leaf-600 focus:ring-4 focus:ring-carrot/60"><span class="font-display font-bold text-xl">FCFA</span></div>
        <p class="mt-1.5 text-slate-700 text-base">Laissez vide pour « prix sur demande ».</p></section>

      <section><h2 class="${lab}">Vendu en</h2>
        <div class="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Conditionnement">${cfg.conditionnements.map((u) => pill('conditionnement', u.valeur, u.label, f.conditionnement === u.valeur)).join('')}</div></section>

      <section><label class="flex items-center justify-between gap-4 min-h-16 rounded-2xl bg-white border-2 border-leaf-100 px-4 cursor-pointer">
        <span class="font-display font-bold text-xl">Disponible à la vente</span>
        <input type="checkbox" id="f-dispo" class="peer sr-only" ${f.disponible ? 'checked' : ''}>
        <span class="switch peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-carrot" aria-hidden="true"></span></label></section>

      <section><label for="f-desc" class="${lab}">Description</label>
        <textarea id="f-desc" rows="4" maxlength="1500" placeholder="Variété, taille, état des plants…" class="w-full rounded-2xl border-2 border-leaf-100 bg-white p-4 text-xl leading-snug focus:outline-none focus:border-leaf-600 focus:ring-4 focus:ring-carrot/60">${esc(f.description)}</textarea></section>

      <details class="rounded-2xl bg-white border-2 border-leaf-100" ${f.conseils ? 'open' : ''}>
        <summary class="min-h-16 px-4 flex items-center font-display font-bold text-xl cursor-pointer">Conseils d’entretien (facultatif)</summary>
        <div class="px-4 pb-4"><textarea id="f-conseils" rows="3" maxlength="1000" placeholder="Arrosage, soleil, quand récolter…" class="w-full rounded-2xl border-2 border-leaf-100 bg-leaf-50 p-4 text-xl leading-snug focus:outline-none focus:border-leaf-600 focus:ring-4 focus:ring-carrot/60">${esc(f.conseils)}</textarea></div>
      </details>

      ${id ? `<p class="pt-2 text-center"><button type="button" data-act="remove" class="min-h-12 px-4 font-bold text-red-800 underline underline-offset-4">Retirer cette plante</button></p>` : ''}
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

  function bindForm() {
    const f = state.form, form = $('#plant');
    const text = (id, key) => $(id).addEventListener('input', (e) => { f[key] = e.target.value; });
    text('#f-titre', 'titre'); text('#f-desc', 'description'); text('#f-conseils', 'conseils');
    $('#f-prix').addEventListener('input', (e) => { e.target.value = f.prix = e.target.value.replace(/\D/g, ''); });
    $('#f-dispo').addEventListener('change', (e) => { f.disponible = e.target.checked; });
    form.addEventListener('change', (e) => { if (e.target.name === 'categorie') f.categorie = e.target.value; if (e.target.name === 'conditionnement') f.conditionnement = e.target.value; });
    // Les champs « photo » sont recréés avec le bloc : on écoute au niveau du formulaire
    form.addEventListener('change', async (e) => {
      if (e.target.id !== 'cam' && e.target.id !== 'gal') return;
      const file = e.target.files?.[0]; if (!file) return;
      f.busy = true; $('#photo').innerHTML = photoBlock();
      try {
        const blob = await compress(file);
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
        f.blob = blob; f.previewUrl = URL.createObjectURL(blob);
      } catch { fail('Cette photo n’a pas pu être lue. Essayez-en une autre.'); }
      f.busy = false; $('#photo').innerHTML = photoBlock();
    });
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
    const f = state.form; $('#err').classList.add('hidden');
    if (f.titre.trim().length < 2) return fail('Indiquez le nom de la plante.', 'f-titre');
    if (!f.categorie) return fail('Choisissez une catégorie.', 'f-categorie');
    if (statut === 'publish' && !f.blob && !f.photoUrl) return fail('Ajoutez une photo avant de publier.', 'f-photo');
    const fd = new FormData();
    fd.append('titre', f.titre.trim()); fd.append('categorie', f.categorie); fd.append('prix', f.prix || '0');
    fd.append('conditionnement', f.conditionnement); fd.append('disponible', f.disponible ? '1' : '0');
    fd.append('description', f.description.trim()); fd.append('conseils', f.conseils.trim()); fd.append('statut', statut);
    if (f.blob) fd.append('photo', f.blob, 'plante.' + (f.blob.type === 'image/webp' ? 'webp' : 'jpg'));
    busy(true, 0);
    try {
      const saved = await upload(f.id ? `/plantes/${f.id}` : '/plantes', fd, (pct) => busy(true, pct));
      const i = state.plantes.findIndex((p) => p.id === saved.id);
      if (i >= 0) state.plantes[i] = saved; else state.plantes.unshift(saved);
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      f.done = true;
      toast(statut === 'publish' ? (f.id && f.statut === 'publish' ? 'Modifications enregistrées' : 'Plante publiée') : 'Brouillon enregistré');
      location.hash = '#/';
    } catch (e) {
      busy(false);
      if (e.code === 'session') return sessionLost();
      fail(e.message);
    }
  }

  /* ---------------- Actions de la liste ---------------- */
  async function setStock(id, on, input) {
    const p = state.plantes.find((x) => x.id === id); if (!p) return;
    const label = $(`[data-stock-label="${id}"]`); if (label) label.textContent = on ? 'En stock' : 'Épuisé';
    try {
      const saved = await api(`/plantes/${id}/disponibilite`, { method: 'POST', json: { disponible: on } });
      Object.assign(p, saved);
      toast(on ? `${p.titre} : en stock` : `${p.titre} : épuisé`);
    } catch (e) {
      input.checked = !on; if (label) label.textContent = !on ? 'En stock' : 'Épuisé';
      if (e.code === 'session') return sessionLost();
      toast(e.message, 'err');
    }
  }

  async function removePlant() {
    const f = state.form; if (!f?.id) return;
    if (!confirm('Retirer cette plante de votre liste et de la boutique ?')) return;
    try {
      await api(`/plantes/${f.id}`, { method: 'DELETE' });
      state.plantes = state.plantes.filter((p) => p.id !== f.id); f.done = true;
      toast('Plante retirée'); location.hash = '#/';
    } catch (e) { if (e.code === 'session') return sessionLost(); toast(e.message, 'err'); }
  }

  async function logout() {
    try { await api('/logout', { method: 'POST' }); } catch {}
    state.me = null; state.plantes = []; state.form = null; location.hash = ''; viewLogin();
  }
  function sessionLost() { state.me = null; viewLogin('Votre session a expiré. Reconnectez-vous.'); }

  app.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]'); if (a?.dataset.act === 'logout') logout(); if (a?.dataset.act === 'remove') removePlant();
    const t = e.target.closest('[data-filter]'); if (t) { state.filter = t.dataset.filter; viewHome(); }
  });
  app.addEventListener('change', (e) => { if (e.target.dataset?.stock) setStock(Number(e.target.dataset.stock), e.target.checked, e.target); });

  /* ---------------- Démarrage ---------------- */
  function route() {
    if (!state.me) return;
    const h = location.hash.replace(/^#\/?/, '');
    window.scrollTo(0, 0);
    if (h === 'nouvelle') return viewForm(null);
    const m = h.match(/^plante\/(\d+)$/); if (m) return viewForm(Number(m[1]));
    viewHome();
  }

  async function boot() {
    try {
      if (!state.me) state.me = await api('/session');
      [state.config, { plantes: state.plantes }] = await Promise.all([api('/config'), api('/plantes')]);
      route();
    } catch (e) {
      if (e.status === 401 || e.status === 403) { state.me = null; return viewLogin(e.status === 403 ? e.message : ''); }
      app.innerHTML = `${banner()}<main class="min-h-screen flex flex-col items-center justify-center gap-5 p-8 text-center"><p class="font-display font-extrabold text-3xl">${esc(e.message)}</p><button class="min-h-14 px-8 rounded-full bg-leaf-900 text-white font-bold text-xl" onclick="location.reload()">Réessayer</button></main>`;
    }
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => state.me && route());
  window.addEventListener('offline', () => state.me && route());
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/agriculteur/sw.js', { scope: '/agriculteur/' }).catch(() => {});
  boot();
})();
