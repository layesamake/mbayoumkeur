// Sélection d'articles (localStorage) + commande par WhatsApp
(() => {
  const KEY = 'mbk_selection_v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const save = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {} };
  const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(n) + ' FCFA';
  const $ = (id) => document.getElementById(id);
  let cart = load();

  const count = () => cart.reduce((s, i) => s + i.qty, 0);
  const badge = () => { const n = count(); document.querySelectorAll('.cart-count').forEach((el) => (el.textContent = n)); };
  // Annonce vocale (lecteurs d'écran) via la zone aria-live du pied de page
  const announce = (msg) => { const el = $('live'); if (!el) return; el.textContent = ''; setTimeout(() => (el.textContent = msg), 50); };
  const plural = (n) => `${n} article${n > 1 ? 's' : ''}`;

  // Statistiques indicatives pour les producteurs (vues, ajouts à la sélection, demandes WhatsApp) : aucune donnée personnelle
  // n'est envoyée, seulement le type d'évènement et les références MK-xxxx des plantes concernées.
  const track = (type, refs) => {
    const url = document.body.dataset.stats;
    refs = (refs || []).filter(Boolean);
    if (!url || !refs.length || navigator.doNotTrack === '1' || !navigator.sendBeacon) return;
    try { navigator.sendBeacon(url, JSON.stringify({ t: type, refs })); } catch { /* sans importance */ }
  };
  const viewed = document.querySelector('[data-vue]');
  if (viewed) track('vue', [viewed.dataset.vue]);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    const { slug, name, price, unit, ref } = btn.dataset;
    const item = cart.find((i) => i.slug === slug);
    if (item) item.qty += 1; else cart.push({ slug, name, ref: ref || '', price: Number(price) || 0, unit, qty: 1 });
    save(cart); badge(); track('ajout', [ref]);
    announce(`${name} ajouté à la sélection. ${plural(count())} au total.`);
    const old = btn.textContent; btn.textContent = '✓ Ajouté'; setTimeout(() => (btn.textContent = old), 1200);
  });

  const list = $('cart-list');
  if (list) {
    const text = () => {
      const name = $('cust-name').value.trim(), addr = $('cust-addr').value.trim();
      const lines = cart.map((i) => `- ${i.qty} × ${i.name}` + (i.ref ? ` [${i.ref}]` : '') + (i.price ? ` (${fcfa(i.price * i.qty)})` : ''));
      const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
      return [`Bonjour ${document.body.dataset.site}, je souhaite commander :`, ...lines,
        total ? `Total estimé : ${fcfa(total)}` : '', name && `Nom : ${name}`, addr && `Livraison : ${addr}`]
        .filter(Boolean).join('\n');
    };
    const render = () => {
      list.innerHTML = '';
      $('cart-empty').hidden = cart.length > 0;
      $('cart-footer').hidden = cart.length === 0;
      cart.forEach((i, idx) => {
        const li = document.createElement('li');
        li.className = 'py-4 flex items-center gap-4';
        li.innerHTML = `<div class="flex-1"><p class="font-medium"></p><p class="text-sm text-slate-600"></p></div>
          <div class="flex items-center gap-2"><button type="button" data-d="${idx}" class="w-11 h-11 text-lg rounded-full border"><span aria-hidden="true">−</span></button><span class="w-6 text-center"></span><button type="button" data-u="${idx}" class="w-11 h-11 text-lg rounded-full border"><span aria-hidden="true">+</span></button></div>
          <button type="button" data-r="${idx}" class="w-11 h-11 text-slate-600 hover:text-red-700 rounded-full"><span aria-hidden="true">✕</span></button>`;
        li.querySelector('p.font-medium').textContent = i.name;
        li.querySelector('p.text-sm').textContent = i.price ? fcfa(i.price) + (i.unit ? ' / ' + i.unit : '') : 'Prix sur demande';
        li.querySelector('span.w-6').textContent = i.qty;
        li.querySelector('[data-d]').setAttribute('aria-label', `Retirer une unité de ${i.name}`);
        li.querySelector('[data-u]').setAttribute('aria-label', `Ajouter une unité de ${i.name}`);
        li.querySelector('[data-r]').setAttribute('aria-label', `Retirer ${i.name} de la sélection`);
        list.appendChild(li);
      });
      const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
      $('cart-total').textContent = total ? fcfa(total) : '—';
      let shops = []; try { shops = JSON.parse(document.body.dataset.shops); } catch {}
      $('wa-links').innerHTML = '';
      shops.forEach((s) => {
        const a = document.createElement('a');
        a.href = `https://wa.me/${s.number}?text=${encodeURIComponent(text())}`;
        a.target = '_blank'; a.rel = 'noopener';
        a.className = 'flex flex-col items-center justify-center min-h-14 text-center bg-[#25D366] hover:brightness-95 text-leaf-900 font-bold py-3 rounded-2xl px-4';
        a.innerHTML = '<span class="block"></span><span class="block text-sm font-semibold"></span><span class="sr-only"> (s’ouvre dans un nouvel onglet)</span>';
        a.children[0].textContent = s.name; a.children[1].textContent = s.display;
        $('wa-links').appendChild(a);
      });
      badge();
    };
    list.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      let msg = '';
      if (b.dataset.u) { const it = cart[b.dataset.u]; it.qty++; msg = `${it.name} : quantité ${it.qty}`; }
      else if (b.dataset.d) { const it = cart[b.dataset.d]; it.qty--; msg = it.qty < 1 ? `${it.name} retiré de la sélection` : `${it.name} : quantité ${it.qty}`; if (it.qty < 1) cart.splice(b.dataset.d, 1); }
      else if (b.dataset.r) { msg = `${cart[b.dataset.r].name} retiré de la sélection`; cart.splice(b.dataset.r, 1); }
      save(cart); render(); announce(msg);
    });
    $('wa-links').addEventListener('click', (e) => { if (e.target.closest('a')) track('commande', cart.map((i) => i.ref)); });
    $('cart-clear').addEventListener('click', () => { cart = []; save(cart); render(); announce('Sélection vidée'); });
    ['cust-name', 'cust-addr'].forEach((id) => $(id).addEventListener('input', render));
    render();
  }
  // Fiche produit : une miniature remplace la grande photo
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-thumb]'); if (!t) return;
    const main = document.getElementById('gallery-main'); if (!main) return;
    main.src = t.dataset.src;
    if (t.dataset.srcset) main.srcset = t.dataset.srcset; else main.removeAttribute('srcset');
    document.querySelectorAll('[data-thumb]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
  });
  badge();
})();
