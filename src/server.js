import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getCatalog } from './wp.js';
import { shopView } from './shop.js';
import { farmerRouter } from './farmer.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_NAME = process.env.SITE_NAME || 'Mbayoumkeur';
// Points de vente : "Nom|221XXXXXXXXX;Nom 2|221YYYYYYYYY" (variable SHOPS pour surcharger)
const DEFAULT_SHOPS = 'Thiès – Quartier Mbambara|221768645834;Grand Mbour|221769410074';
const SHOPS = (process.env.SHOPS || DEFAULT_SHOPS).split(';').map((s) => {
  const [name, number] = s.split('|');
  const digits = (number || '').replace(/\D/g, '');
  const local = digits.startsWith('221') ? digits.slice(3) : digits;
  return { name: name.trim(), number: digits, display: `+221 ${local.replace(/(\d{2})(\d{3})(\d{2})(\d{2})/, '$1 $2 $3 $4')}` };
}).filter((s) => s.name && s.number);

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(root, 'src/views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.static(path.join(root, 'public'), { maxAge: '5m', redirect: false }));
// Espace agriculteur : avant le chargement du catalogue (il n'en a pas besoin)
app.use('/agriculteur', farmerRouter());
// Adresses courtes à retenir et à dicter : mbayoumkeur.shop/agriculteurs (ou /producteurs)
app.get(['/agriculteurs', '/producteurs'], (req, res) => res.redirect(302, '/agriculteur'));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(n) + ' FCFA';

app.use(wrap(async (req, res, next) => {
  const { products, source } = await getCatalog();
  req.products = products;
  Object.assign(res.locals, {
    siteName: SITE_NAME, shops: SHOPS, source,
    instagram: process.env.INSTAGRAM_URL || 'https://www.instagram.com/mbayoumkeurshop/',
    facebook: process.env.FACEBOOK_URL || 'https://www.facebook.com/mbayoumkeur', fcfa, q: '',
    baseUrl: `${req.protocol}://${req.get('host')}`,
    cur: (p) => (req.path === p ? 'aria-current="page"' : ''),
    categories: [...new Set(products.map((p) => p.category))].map((name) => ({
      name, count: products.filter((p) => p.category === name).length,
    })),
  });
  next();
}));

const PAGE = 24;
app.get('/', (req, res) => {
  const featured = res.locals.categories.map((c) => ({ ...c, sample: req.products.find((p) => p.category === c.name) }));
  res.render('home', { home: true, featured, latest: req.products.slice(0, 8), total: req.products.length });
});
app.get('/boutique', (req, res) => {
  const v = shopView(req.products, req.query);
  res.render('shop', { v, q: v.f.q, cat: v.f.cats.length === 1 ? v.f.cats[0] : undefined, noHeaderSearch: true, title: 'Boutique' });
});
app.get('/produit/:slug', (req, res) => {
  const p = req.products.find((x) => x.slug === req.params.slug);
  if (!p) return res.status(404).render('404');
  res.render('product', { p, related: req.products.filter((x) => x.category === p.category && x !== p).slice(0, 4) });
});
app.get('/ma-selection', (req, res) => res.render('cart'));
app.get('/notre-histoire', (req, res) => res.render('about'));
app.get('/nous-contacter', (req, res) => res.render('contact'));
app.get('/health', (req, res) => res.send('ok'));
app.use((req, res) => res.status(404).render('404'));
app.use((err, req, res, next) => { console.error(err); res.status(500).send('Erreur serveur'); });

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`http://localhost:${port}`));
