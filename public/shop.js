// Boutique : filtres en direct (le serveur reste la source de vérité), curseur de prix à deux poignées, tiroir mobile.
(() => {
  const form = document.getElementById('filters-form');
  const results = document.getElementById('results');
  if (!form || !results) return;

  const fr = new Intl.NumberFormat('fr-FR');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const live = (msg) => { const el = document.getElementById('live'); if (el) { el.textContent = ''; setTimeout(() => (el.textContent = msg), 50); } };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ---------- Curseur de prix ----------
  const priceBox = form.querySelector('[data-price]');
  const range = form.querySelector('.range');
  const [minEl, maxEl] = range ? range.querySelectorAll('input') : [];
  const paint = () => {
    if (!range) return;
    const lo = +priceBox.dataset.lo, hi = +priceBox.dataset.hi, a = +minEl.value, b = +maxEl.value;
    range.style.setProperty('--f', (a - lo) / (hi - lo));
    range.style.setProperty('--t', (b - lo) / (hi - lo));
    priceBox.querySelector('[data-out=min]').textContent = fr.format(a);
    priceBox.querySelector('[data-out=max]').textContent = fr.format(b);
    priceBox.querySelectorAll('[data-a]').forEach((bar) => {
      const on = +bar.dataset.b > a && +bar.dataset.a < b;
      bar.classList.toggle('bg-leaf-500', on); bar.classList.toggle('bg-leaf-100', !on);
    });
  };
  if (range) {
    [minEl, maxEl].forEach((el) => el.addEventListener('input', () => {
      // les poignées ne se croisent pas
      if (+minEl.value > +maxEl.value) { if (el === minEl) minEl.value = maxEl.value; else maxEl.value = minEl.value; }
      // celle qui bouge reste au-dessus quand les deux se rejoignent
      minEl.style.zIndex = +minEl.value >= +priceBox.dataset.hi - +minEl.step ? 3 : '';
      paint();
    }));
  }

  // ---------- Requête : le formulaire devient une adresse ----------
  const buildURL = () => {
    const p = new URLSearchParams();
    for (const [k, v] of new FormData(form)) {
      if (v === '' || (k === 'tri' && v === 'recent')) continue;
      if (priceBox && ((k === 'min' && +v <= +priceBox.dataset.lo) || (k === 'max' && +v >= +priceBox.dataset.hi))) continue;
      p.append(k, v);
    }
    const s = p.toString();
    return '/boutique' + (s ? '?' + s : '');
  };

  let ctrl;
  const load = async (url, { scroll = false, sync = false } = {}) => {
    ctrl?.abort(); ctrl = new AbortController();
    results.setAttribute('aria-busy', 'true'); results.classList.add('opacity-60', 'transition-opacity');
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'X-Requested-With': 'fetch' } });
      if (!res.ok) throw new Error(res.status);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const fresh = new Map([...doc.querySelectorAll('[data-live]')].map((el) => [el.dataset.live, el]));
      document.querySelectorAll('[data-live]').forEach((el) => {
        const n = fresh.get(el.dataset.live);
        if (!n) return;
        el.innerHTML = n.innerHTML; el.className = n.className;
      });
      history.replaceState(null, '', url);
      if (sync) syncControls(new URL(url, location.origin).searchParams);
      paint();
      const count = doc.querySelector('[data-count]')?.dataset.count;
      if (count != null) live(`${count} produit${count > 1 ? 's' : ''}`);
      if (scroll) results.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    } catch (err) {
      if (err.name !== 'AbortError') location.href = url; // repli : chargement classique
    } finally {
      results.removeAttribute('aria-busy'); results.classList.remove('opacity-60');
    }
  };

  // Remet les contrôles en accord avec l'adresse (après retrait d'une pastille, « Tout effacer »…)
  const syncControls = (params) => {
    form.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = params.getAll(c.name).includes(c.value); });
    const q = document.getElementById('q'); if (q && document.activeElement !== q) q.value = params.get('q') || '';
    const tri = document.getElementById('tri'); if (tri) tri.value = params.get('tri') || 'recent';
    if (range) {
      minEl.value = params.get('min') ?? priceBox.dataset.lo;
      maxEl.value = params.get('max') ?? priceBox.dataset.hi;
    }
  };

  const refresh = debounce(() => load(buildURL()), 220);
  // `e.target.form` : la recherche et le tri sont hors du <form> mais lui sont rattachés (attribut form=)
  document.addEventListener('change', (e) => { if (e.target.form === form) refresh(); });
  document.addEventListener('input', (e) => { if (e.target.form === form && (e.target.type === 'range' || e.target.type === 'search')) refresh(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); closeSheet(); load(buildURL()); });

  // Pastilles, « Tout effacer », pagination : sans rechargement
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-nav]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    load(a.getAttribute('href'), { scroll: a.hasAttribute('data-page'), sync: true });
  });

  // ---------- Tiroir mobile ----------
  const opener = document.querySelector('[data-open-filters]');
  const backdrop = document.querySelector('[data-backdrop]');
  const mobile = matchMedia('(max-width: 1023px)');
  let lastFocus;
  const openSheet = () => {
    lastFocus = document.activeElement;
    form.setAttribute('data-open', ''); opener?.setAttribute('aria-expanded', 'true');
    form.setAttribute('role', 'dialog'); form.setAttribute('aria-modal', 'true'); form.setAttribute('aria-label', 'Filtres');
    backdrop?.classList.remove('opacity-0', 'pointer-events-none'); document.body.style.overflow = 'hidden';
    form.querySelector('[data-close-filters]')?.focus();
  };
  function closeSheet() {
    if (!form.hasAttribute('data-open')) return;
    form.removeAttribute('data-open'); opener?.setAttribute('aria-expanded', 'false');
    ['role', 'aria-modal', 'aria-label'].forEach((a) => form.removeAttribute(a));
    backdrop?.classList.add('opacity-0', 'pointer-events-none'); document.body.style.overflow = '';
    lastFocus?.focus?.();
  }
  opener?.addEventListener('click', openSheet);
  backdrop?.addEventListener('click', closeSheet);
  form.addEventListener('click', (e) => { if (e.target.closest('[data-close-filters]')) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  mobile.addEventListener('change', (e) => { if (!e.matches) closeSheet(); });
  paint();
})();
