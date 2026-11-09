// Sélection d'articles (localStorage) + commande par WhatsApp
(() => {
  const KEY = 'mbk_selection_v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const save = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {} };
  const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(n) + ' FCFA';
  const $ = (id) => document.getElementById(id);
  let cart = load();

  const badge = () => { const el = $('cart-count'); if (el) el.textContent = cart.reduce((s, i) => s + i.qty, 0); };

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    const { slug, name, price, unit } = btn.dataset;
    const item = cart.find((i) => i.slug === slug);
    if (item) item.qty += 1; else cart.push({ slug, name, price: Number(price) || 0, unit, qty: 1 });
    save(cart); badge();
    const old = btn.textContent; btn.textContent = '✓ Ajouté'; setTimeout(() => (btn.textContent = old), 1200);
  });

  const list = $('cart-list');
  if (list) {
    const text = () => {
      const name = $('cust-name').value.trim(), addr = $('cust-addr').value.trim();
      const lines = cart.map((i) => `- ${i.qty} × ${i.name}` + (i.price ? ` (${fcfa(i.price * i.qty)})` : ''));
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
        li.innerHTML = `<div class="flex-1"><p class="font-medium"></p><p class="text-sm text-slate-500"></p></div>
          <div class="flex items-center gap-2"><button data-d="${idx}" class="w-8 h-8 rounded-full border">−</button><span class="w-6 text-center"></span><button data-u="${idx}" class="w-8 h-8 rounded-full border">+</button></div>
          <button data-r="${idx}" class="text-slate-400 hover:text-red-600" aria-label="Retirer">✕</button>`;
        li.querySelector('p.font-medium').textContent = i.name;
        li.querySelector('p.text-sm').textContent = i.price ? fcfa(i.price) + (i.unit ? ' / ' + i.unit : '') : 'Prix sur demande';
        li.querySelector('span').textContent = i.qty;
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
        a.className = 'block text-center bg-[#25D366] hover:brightness-95 text-white font-semibold py-3 rounded-2xl px-4';
        a.innerHTML = '<span class="block"></span><span class="block text-xs font-normal opacity-90"></span>';
        a.children[0].textContent = s.name; a.children[1].textContent = s.display;
        $('wa-links').appendChild(a);
      });
      badge();
    };
    list.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.u) cart[b.dataset.u].qty++;
      else if (b.dataset.d) { cart[b.dataset.d].qty--; if (cart[b.dataset.d].qty < 1) cart.splice(b.dataset.d, 1); }
      else if (b.dataset.r) cart.splice(b.dataset.r, 1);
      save(cart); render();
    });
    $('cart-clear').addEventListener('click', () => { cart = []; save(cart); render(); });
    ['cust-name', 'cust-addr'].forEach((id) => $(id).addEventListener('input', render));
    render();
  }
  badge();
})();
