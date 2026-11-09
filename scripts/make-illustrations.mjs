// Génère des illustrations SVG originales pour les produits de démonstration.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';

const demo = JSON.parse(readFileSync(new URL('../data/demo-products.json', import.meta.url), 'utf8'));
const out = new URL('../public/img/products/', import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pot = (c = '#c2703d') => `<path d="M170 380h160l-18 90q-2 10-12 10h-100q-10 0-12-10z" fill="${c}"/><rect x="160" y="366" width="180" height="22" rx="6" fill="${c}" opacity=".85"/>`;
const leaf = (x, y, r, s, c) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M0 0C-40-40-30-110 0-150C30-110 40-40 0 0Z" fill="${c}"/><path d="M0 0V-140" stroke="#ffffff55" stroke-width="3"/></g>`;

const drawings = {
  'Herbes aromatiques': (g) => `${pot('#b8683a')}${Array.from({ length: 9 }, (_, i) => leaf(250, 372, -70 + i * 17.5, 0.7 + (i % 3) * 0.15, i % 2 ? g[0] : g[1])).join('')}`,
  'Plantes comestibles': (g, v, f) => `${pot('#b0653a')}${[-55, -20, 20, 55].map((r) => leaf(250, 372, r, 0.85, g[0])).join('')}${[[200, 330], [290, 320], [250, 290], [315, 345]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="16" fill="${f}"/><path d="M${x - 8} ${y - 14}l8 6l8-6" stroke="${g[1]}" stroke-width="4" fill="none"/>`).join('')}`,
  'Arbres fruitiers': (g, v, f) => `<rect x="238" y="250" width="26" height="150" rx="8" fill="#7a5230"/>${pot('#a45c33')}<circle cx="250" cy="200" r="105" fill="${g[1]}"/><circle cx="195" cy="230" r="65" fill="${g[0]}"/><circle cx="305" cy="225" r="68" fill="${g[0]}"/>${[[210, 190], [290, 170], [250, 240], [320, 250], [190, 255]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="14" fill="${f}"/>`).join('')}`,
  'Terreaux et substrat': () => `<path d="M150 150q100-30 200 0l20 320q-120 22-240 0z" fill="#8a5a36"/><path d="M150 150q100-30 200 0l-6 60q-94-26-188 0z" fill="#6f4426"/><rect x="190" y="260" width="120" height="110" rx="14" fill="#f4ead8"/><path d="M250 285c-22 18-22 46 0 62c22-16 22-44 0-62z" fill="#3fae5e"/><path d="M250 347v-40" stroke="#26753c" stroke-width="4"/>`,
  'Accessoires de jardinage': () => `<g transform="rotate(-30 250 260)"><rect x="236" y="120" width="28" height="210" rx="10" fill="#9a6a3a"/><path d="M205 330h90l-14 90q-31 22-62 0z" fill="#7d8b96"/></g><g transform="rotate(32 250 260)"><rect x="238" y="140" width="24" height="170" rx="10" fill="#c9462f"/><path d="M215 308h70v74q-35 20-70 0z" fill="#9aa5ad"/></g><circle cx="250" cy="262" r="12" fill="#f6c343"/>`,
};
const greens = [['#2f8f4a', '#3fae5e'], ['#26753c', '#4ea867'], ['#3a9b55', '#2a7a43']];
const fruits = ['#f2a900', '#e0452c', '#d94f8a', '#f08a24', '#e8c21f'];
const bg = { 'Herbes aromatiques': '#eef7e1', 'Plantes comestibles': '#fde9e4', 'Arbres fruitiers': '#fdf3dc', 'Terreaux et substrat': '#f1e6da', 'Accessoires de jardinage': '#e4eef5' };

demo.forEach((p, i) => {
  const g = greens[i % 3], f = fruits[i % 5];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" role="img" aria-label="${p.name}"><rect width="500" height="500" fill="${bg[p.category]}"/><circle cx="250" cy="260" r="215" fill="#ffffff" opacity=".55"/>${drawings[p.category](g, i, f)}<ellipse cx="250" cy="484" rx="100" ry="8" fill="#00000018"/></svg>`;
  writeFileSync(new URL(`${slugify(p.name)}.svg`, out), svg);
});
console.log(demo.length, 'illustrations générées');
