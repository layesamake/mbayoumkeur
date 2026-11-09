import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getCatalog } from './wp.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_NAME = process.env.SITE_NAME || 'Mbayoumkeur';
const WHATSAPP = (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, ''); // ex. 221771234567

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(root, 'src/views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.static(path.join(root, 'public'), { maxAge: '1h' }));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(n) + ' FCFA';

app.use(wrap(async (req, res, next) => {
  const { products, source } = await getCatalog();
  req.products = products;
  Object.assign(res.locals, {
    siteName: SITE_NAME, whatsapp: WHATSAPP, source, fcfa, q: '',
    categories: [...new Set(products.map((p) => p.category))].map((name) => ({
      name, count: products.filter((p) => p.category === name).length,
    })),
  });
  next();
}));

const PAGE = 24;
app.get('/', (req, res) => {
  const featured = res.locals.categories.map((c) => ({ ...c, sample: req.products.find((p) => p.category === c.name) }));
  res.render('home', { featured, latest: req.products.slice(0, 8), total: req.products.length });
});
app.get('/boutique', (req, res) => {
  const q = String(req.query.q || '').trim();
  const cat = String(req.query.categorie || '');
  const page = Math.max(1, parseInt(req.query.page) || 1);
  let list = req.products;
  if (cat) list = list.filter((p) => p.category === cat);
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  res.render('shop', { items: list.slice((page - 1) * PAGE, page * PAGE), q, cat, page, pages, count: list.length });
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
