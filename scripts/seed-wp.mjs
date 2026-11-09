// Crée dans WordPress 3 produits d'exemple par catégorie (data/demo-products.json).
// Usage : WP_USER=... WP_APP_PASSWORD="xxxx xxxx xxxx" node scripts/seed-wp.mjs
// (mot de passe d'application : WordPress > Utilisateurs > Profil > Mots de passe d'application)
import { readFileSync } from 'node:fs';

const WP = (process.env.WP_URL || 'https://cms.mbayoumkeur.shop').replace(/\/$/, '');
const { WP_USER, WP_APP_PASSWORD } = process.env;
if (!WP_USER || !WP_APP_PASSWORD) { console.error('WP_USER et WP_APP_PASSWORD requis'); process.exit(1); }

const auth = 'Basic ' + Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');
const api = async (route, opts = {}) => {
  const res = await fetch(`${WP}/wp-json/wp/v2/${route}`, {
    ...opts, headers: { Authorization: auth, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${route} -> ${res.status} ${await res.text()}`);
  return res.json();
};
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const demo = JSON.parse(readFileSync(new URL('../data/demo-products.json', import.meta.url), 'utf8'));
const termIds = new Map();
for (const name of new Set(demo.map((p) => p.category))) {
  const found = await api(`categories-produit?search=${encodeURIComponent(name)}&per_page=100`);
  const hit = found.find((t) => t.name.replace(/&amp;/g, '&') === name);
  const term = hit || await api('categories-produit', { method: 'POST', body: JSON.stringify({ name, slug: slugify(name) }) });
  termIds.set(name, term.id);
  console.log(hit ? 'catégorie existante' : 'catégorie créée', '-', name);
}
for (const p of demo) {
  const slug = slugify(p.name);
  const exists = await api(`produits?slug=${slug}&status=any`);
  if (exists.length) { console.log('déjà là      -', p.name); continue; }
  await api('produits', {
    method: 'POST',
    body: JSON.stringify({
      title: p.name, slug, status: 'publish', content: `<p>${p.description}</p>`, excerpt: p.description,
      categorie_produit: [termIds.get(p.category)],
      meta: { prix: 0, unite: p.unit, disponible: true },
    }),
  });
  console.log('produit créé -', p.name);
}
console.log('Terminé. Ajoutez prix et photos dans WordPress > Produits.');
