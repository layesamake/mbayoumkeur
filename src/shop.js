// Boutique : lecture des filtres (URL), filtrage, tri, facettes (compteurs, histogramme des prix) et pastilles actives.
// Tout est calculé côté serveur : la page fonctionne sans JavaScript et chaque recherche a une adresse partageable.
export const PAGE_SIZE = 24;
const SORTS = {
  recent: 'Nouveautés',
  'prix-asc': 'Prix croissant',
  'prix-desc': 'Prix décroissant',
  nom: 'Nom, de A à Z',
};
const BINS = 24;

const list = (v) => [].concat(v ?? []).map((s) => String(s).trim()).filter(Boolean);
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : null; };
const fold = (s = '') => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function parseFilters(query) {
  return {
    q: String(query.q || '').trim().slice(0, 80),
    cats: list(query.categorie),
    units: list(query.unite),
    min: int(query.min),
    max: int(query.max),
    dispo: query.dispo === '1',
    sansPrix: query.sans_prix === '1',
    sort: SORTS[query.tri] ? query.tri : 'recent',
    page: Math.max(1, parseInt(query.page, 10) || 1),
  };
}

// Adresse de la boutique pour un jeu de filtres (les valeurs par défaut ne sont pas écrites)
export function toQS(f, page = 1) {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  f.cats.forEach((c) => p.append('categorie', c));
  f.units.forEach((u) => p.append('unite', u));
  if (f.min != null) p.set('min', f.min);
  if (f.max != null) p.set('max', f.max);
  if (f.dispo) p.set('dispo', '1');
  if (f.sansPrix) p.set('sans_prix', '1');
  if (f.sort !== 'recent') p.set('tri', f.sort);
  if (page > 1) p.set('page', page);
  const s = p.toString();
  return '/boutique' + (s ? '?' + s : '');
}

// `skip` : critères ignorés, pour compter ce qui resterait si on changeait ce critère
function matches(p, f, skip = '') {
  if (f.q) {
    const hay = fold(`${p.name} ${p.category} ${p.unit} ${p.excerpt}`);
    if (!fold(f.q).split(/\s+/).every((t) => hay.includes(t))) return false;
  }
  if (skip !== 'cats' && f.cats.length && !f.cats.includes(p.category)) return false;
  if (skip !== 'units' && f.units.length && !f.units.includes(p.unit)) return false;
  if (skip !== 'dispo' && f.dispo && !p.available) return false;
  if (skip !== 'sansPrix' && f.sansPrix && !p.price) return false;
  if (skip !== 'price' && p.price) {
    if (f.min != null && p.price < f.min) return false;
    if (f.max != null && p.price > f.max) return false;
  }
  return true;
}

function sorted(items, sort) {
  const out = [...items];
  if (sort === 'nom') out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  else if (sort === 'prix-asc') out.sort((a, b) => (a.price || Infinity) - (b.price || Infinity));
  else if (sort === 'prix-desc') out.sort((a, b) => (b.price || -1) - (a.price || -1));
  return out;
}

// Bornes du curseur de prix : nécessite au moins deux prix différents dans le catalogue
function priceBounds(all) {
  const priced = all.filter((p) => p.price > 0).map((p) => p.price);
  if (priced.length < 2 || Math.min(...priced) === Math.max(...priced)) return null;
  const top = Math.max(...priced);
  const step = top <= 1000 ? 50 : top <= 10000 ? 100 : 500;
  return { step, lo: Math.floor(Math.min(...priced) / step) * step, hi: Math.ceil(top / step) * step };
}

function priceFacet(all, f, bounds) {
  if (!bounds) return null;
  const { lo, hi, step } = bounds;
  const bins = Array(BINS).fill(0);
  all.filter((p) => p.price > 0 && matches(p, f, 'price')).forEach((p) => {
    bins[Math.min(BINS - 1, Math.floor(((p.price - lo) / (hi - lo)) * BINS))]++;
  });
  const peak = Math.max(1, ...bins);
  return {
    lo, hi, step,
    from: Math.min(Math.max(f.min ?? lo, lo), hi),
    to: Math.max(Math.min(f.max ?? hi, hi), lo),
    bars: bins.map((n, i) => ({
      n, h: n ? Math.max(12, Math.round((n / peak) * 100)) : 0,
      a: lo + (i * (hi - lo)) / BINS, b: lo + ((i + 1) * (hi - lo)) / BINS,
    })),
  };
}

export function shopView(products, query) {
  const f = parseFilters(query);
  const bounds = priceBounds(products);
  // un curseur laissé aux extrémités (ou sans prix dans le catalogue) n'est pas un filtre
  if (!bounds || (f.min != null && f.min <= bounds.lo)) f.min = null;
  if (!bounds || (f.max != null && f.max >= bounds.hi)) f.max = null;
  const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(n));

  const all = sorted(products.filter((p) => matches(p, f)), f.sort);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(f.page, pages);

  const facet = (key, valueOf, selected) => {
    const names = [...new Set(products.map(valueOf).filter(Boolean))];
    const counts = names.map((name) => ({
      name, selected: selected.includes(name),
      count: products.filter((p) => valueOf(p) === name && matches(p, f, key)).length,
    }));
    const top = Math.max(1, ...counts.map((c) => c.count));
    return counts.map((c) => ({ ...c, share: Math.round((c.count / top) * 100) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'));
  };

  const chips = [];
  const drop = (mut) => { const g = { ...f, cats: [...f.cats], units: [...f.units] }; mut(g); return toQS(g); };
  if (f.q) chips.push({ label: `« ${f.q} »`, href: drop((g) => (g.q = '')) });
  f.cats.forEach((c) => chips.push({ label: c, href: drop((g) => (g.cats = g.cats.filter((x) => x !== c))) }));
  f.units.forEach((u) => chips.push({ label: u, href: drop((g) => (g.units = g.units.filter((x) => x !== u))) }));
  if (f.min != null || f.max != null) {
    const label = f.min != null && f.max != null ? `${fcfa(f.min)} à ${fcfa(f.max)} FCFA` : f.min != null ? `dès ${fcfa(f.min)} FCFA` : `jusqu’à ${fcfa(f.max)} FCFA`;
    chips.push({ label, href: drop((g) => { g.min = null; g.max = null; }) });
  }
  if (f.dispo) chips.push({ label: 'En stock', href: drop((g) => (g.dispo = false)) });
  if (f.sansPrix) chips.push({ label: 'Prix affiché', href: drop((g) => (g.sansPrix = false)) });

  return {
    f, page, pages, count: all.length, total: products.length,
    items: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    cats: facet('cats', (p) => p.category, f.cats),
    units: facet('units', (p) => p.unit, f.units),
    price: priceFacet(products, f, bounds),
    stockCount: products.filter((p) => p.available && matches(p, f, 'dispo')).length,
    noPriceCount: products.filter((p) => !p.price && matches(p, f, 'sansPrix')).length,
    sorts: SORTS, chips, href: (n) => toQS(f, n), reset: '/boutique', fcfa,
    narrowed: chips.length > 0,
  };
}
