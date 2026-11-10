// Source de contenu : WordPress headless (type de contenu « produit »),
// avec cache mémoire et repli sur data/demo-products.json si WordPress est vide ou injoignable.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WP_URL = (process.env.WP_URL || 'https://cms.mbayoumkeur.shop').replace(/\/$/, '');
const TTL = Number(process.env.CACHE_SECONDS || 60) * 1000;

const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const strip = (html = '') => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#8217;/g, '’').replace(/&amp;/g, '&').trim();

const demo = JSON.parse(readFileSync(path.join(root, 'data/demo-products.json'), 'utf8')).map((p) => ({
  slug: slugify(p.name), name: p.name, category: p.category, image: `/img/products/${slugify(p.name)}.svg`, excerpt: p.description,
  html: `<p>${p.description}</p>`, price: 0, unit: p.unit, available: true,
}));

let cache = { at: 0, data: null };

async function fetchType(type) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${WP_URL}/wp-json/wp/v2/${type}?per_page=100&page=${page}&_embed=wp:featuredmedia,wp:term`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`WP ${type} -> ${res.status}`);
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

// Type « produits » (plugin mbayoumkeur-produits) + type « plante » (champs ACF)
async function fetchAll() {
  const [produits, plantes] = await Promise.all([
    fetchType('produits').then((l) => l.map(toProduct)),
    // le type « plante » est optionnel : s'il est absent ou en erreur, on ignore
    fetchType('plante').then((l) => l.map(toPlante)).catch((err) => { console.error('WordPress plante :', err.message); return []; }),
  ]);
  return [...produits, ...plantes];
}

const ref = (id) => 'MK-' + String(id).padStart(4, '0');

function toProduct(post) {
  const terms = (post._embedded?.['wp:term'] || []).flat().filter((t) => t.taxonomy === 'categorie_produit');
  const media = post._embedded?.['wp:featuredmedia']?.[0];
  const m = post.meta || {};
  return {
    ref: ref(post.id),
    slug: post.slug,
    name: strip(post.title.rendered),
    category: terms[0]?.name || 'Divers',
    image: media?.media_details?.sizes?.large?.source_url || media?.source_url || '',
    excerpt: strip(post.excerpt?.rendered),
    html: post.content?.rendered || '',
    price: Number(m.prix) || 0,
    unit: m.unite || '',
    available: m.disponible !== false,
  };
}

const CATEGORIES = {
  'herbes-aromatiques': 'Herbes aromatiques',
  'plantes-comestibles': 'Plantes comestibles',
  'arbres-fruitiers': 'Arbres fruitiers',
  'terreaux-et-substrat': 'Terreaux et substrat',
  'accessoires-de-jardinage': 'Accessoires de jardinage',
};
const UNITS = { alveole: 'alvéole', pot: 'pot', sachet: 'sachet', plant: 'plant', botte: 'botte' };

function toPlante(post) {
  const a = post.acf || {};
  const media = post._embedded?.['wp:featuredmedia']?.[0];
  const cat = a.categorie_univers;
  return {
    ref: ref(post.id),
    slug: post.slug,
    name: strip(post.title.rendered),
    category: CATEGORIES[cat] || (cat ? cat.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Divers'),
    image: media?.media_details?.sizes?.large?.source_url || media?.source_url || '',
    excerpt: strip(a.conseils_entretien || post.excerpt?.rendered),
    html: post.content?.rendered || '',
    price: Number(a.prix_unitaire) || 0,
    unit: UNITS[a.conditionnement] || a.conditionnement || '',
    available: a.disponible !== false && a.disponible !== 0,
  };
}

export async function getCatalog() {
  if (cache.data && Date.now() - cache.at < TTL) return cache.data;
  let data;
  try {
    const products = await fetchAll();
    data = products.length ? { source: 'wordpress', products } : { source: 'demo', products: demo };
  } catch (err) {
    console.error('WordPress indisponible :', err.message);
    if (cache.data) return cache.data;
    data = { source: 'demo', products: demo };
  }
  cache = { at: Date.now(), data };
  return data;
}
