// Espace agriculteur : l'application mobile (/agriculteur) parle à ce serveur, qui parle à WordPress (mbk/v1)
// avec le mot de passe d'application PROPRE à l'agriculteur. Le navigateur ne voit jamais ce mot de passe :
// il reste chiffré (AES-256-GCM) dans un cookie httpOnly.
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { describePlant, identifyPlant, aiEnabled } from './ai.js';

const WP_URL = (process.env.WP_URL || 'https://cms.mbayoumkeur.shop').replace(/\/$/, '');
const COOKIE = 'mbk_agri';
const MAX_AGE = 30 * 24 * 3600; // 30 jours : l'agriculteur ne retape pas son mot de passe tous les matins

// Clé de chiffrement : FARMER_SECRET (32 caractères ou plus) en production ; sinon clé éphémère (sessions perdues au redémarrage)
let secret = process.env.FARMER_SECRET || '';
if (secret.length < 32) {
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('Espace agriculteur : FARMER_SECRET (32 caractères minimum) non défini — clé temporaire, les sessions ne survivront pas à un redémarrage.');
}
const KEY = crypto.createHash('sha256').update(secret).digest();

const seal = (obj) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
};
const unseal = (token) => {
  try {
    const b = Buffer.from(token, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    const obj = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
    return obj.exp > Date.now() ? obj : null;
  } catch { return null; }
};

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));
const setSession = (req, res, data) => res.cookie(COOKIE, seal({ ...data, exp: Date.now() + MAX_AGE * 1000 }), {
  httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: MAX_AGE * 1000, path: '/agriculteur',
});

class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

// WordPress, au nom de l'agriculteur (sess) ou sans identité (connexion)
async function wp(sess, method, route, { json, form } = {}) {
  const headers = { Accept: 'application/json' };
  if (sess) headers.Authorization = 'Basic ' + Buffer.from(`${sess.u}:${sess.p}`).toString('base64');
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  let res;
  try {
    res = await fetch(`${WP_URL}/wp-json/mbk/v1${route}`, { method, headers, body, signal: AbortSignal.timeout(90000) });
  } catch {
    throw new HttpError(502, 'Le serveur ne répond pas. Vérifiez votre connexion et réessayez.', 'reseau');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const code = data?.code;
    // identifiants de session révoqués ou expirés côté WordPress
    if (sess && (res.status === 401 || code === 'rest_forbidden' || code === 'incorrect_password')) throw new HttpError(401, 'Session expirée. Reconnectez-vous.', 'session');
    throw new HttpError(res.status >= 400 && res.status < 600 ? res.status : 502, data?.message || 'Erreur du serveur.', code);
  }
  return data;
}

// Limite de tentatives de connexion par adresse (en plus de celle de WordPress)
const tries = new Map();
const tooMany = (ip) => {
  const now = Date.now();
  const list = (tries.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  tries.set(ip, list);
  return list.length >= 12;
};

// Assistant : 6 demandes par minute (tous types confondus), 30 descriptions et 40 identifications par jour et par agriculteur
// (chaque demande coûte un appel au modèle)
const aiUse = new Map();
const AI_DAY = { description: 30, identification: 40 };
const aiLimit = (id, kind = 'description') => {
  const now = Date.now();
  const all = (aiUse.get(id) || []).filter((t) => now - t.at < 24 * 3600 * 1000);
  if (all.filter((t) => now - t.at < 60 * 1000).length >= 6) throw new HttpError(429, 'Doucement : réessayez dans une minute.', 'ia_occupe');
  if (all.filter((t) => t.kind === kind).length >= AI_DAY[kind]) {
    throw new HttpError(429, kind === 'identification' ? 'Vous avez atteint la limite d’identifications pour aujourd’hui. Saisissez le nom vous-même.' : 'Vous avez atteint la limite de descriptions pour aujourd’hui. Rédigez celle-ci vous-même.', 'ia_limite');
  }
  all.push({ at: now, kind }); aiUse.set(id, all);
};

// « cle » : identifiant unique d'un envoi (création), pour qu'un renvoi après coupure réseau ne crée jamais de doublon
// « retirer » : identifiants des photos supplémentaires à supprimer (séparés par des virgules)
const FIELDS = ['titre', 'nom_local', 'categorie', 'prix', 'conditionnement', 'disponible', 'description', 'conseils', 'statut', 'cle', 'retirer'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 5 }, fileFilter: (req, file, cb) => (/^image\/(jpeg|png|webp)$/.test(file.mimetype) ? cb(null, true) : cb(new HttpError(415, 'Format de photo non accepté (JPEG, PNG ou WebP).', 'photo'))) });

// Photo principale + 4 photos supplémentaires au maximum (5 photos par plante)
const PHOTO_FIELDS = ['photo', 'extra_1', 'extra_2', 'extra_3', 'extra_4'];
const plantPhotos = upload.fields(PHOTO_FIELDS.map((name) => ({ name, maxCount: 1 })));

// Reconstitue le formulaire envoyé à WordPress : champs autorisés + photos
const toForm = (req) => {
  const form = new FormData();
  for (const k of FIELDS) if (req.body?.[k] !== undefined) form.append(k, String(req.body[k]));
  for (const k of PHOTO_FIELDS) {
    const f = req.files?.[k]?.[0];
    if (f) form.append(k, new Blob([f.buffer], { type: f.mimetype }), f.originalname || 'plante.webp');
  }
  return form;
};

export function farmerRouter() {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // Page de l'application (une seule, l'écran affiché dépend de la session)
  r.get('/', (req, res) => res.render('farmer', { siteName: process.env.SITE_NAME || 'Mbayoumkeur' }));

  const api = express.Router();
  api.use(express.json({ limit: '20kb' }));
  // Contre les requêtes envoyées depuis un autre site : le navigateur n'ajoute pas cet en-tête sans autorisation préalable
  api.use((req, res, next) => (req.method !== 'GET' && req.get('X-Requested-With') !== 'fetch' ? res.status(403).json({ message: 'Requête refusée.' }) : next()));

  const auth = (req, res, next) => {
    const sess = unseal(cookies(req)[COOKIE] || '');
    if (!sess) return res.status(401).json({ message: 'Connectez-vous.', code: 'session' });
    req.sess = sess; next();
  };

  api.post('/login', wrap(async (req, res) => {
    const ip = req.ip;
    if (tooMany(ip)) throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.', 'trop_essais');
    const { identifiant, motdepasse } = req.body || {};
    try {
      const out = await wp(null, 'POST', '/login', { json: { identifiant, motdepasse } });
      setSession(req, res, { u: out.identifiant, p: out.motdepasse_application, id: out.id, nom: out.nom });
      res.json({ nom: out.nom, id: out.id });
    } catch (err) {
      if (err.status === 401 || err.status === 429) tries.set(ip, [...(tries.get(ip) || []), Date.now()]);
      throw err;
    }
  }));

  api.post('/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/agriculteur' }); res.json({ ok: true }); });
  api.get('/session', auth, (req, res) => res.json({ nom: req.sess.nom, id: req.sess.id }));
  api.get('/config', auth, wrap(async (req, res) => res.json({ ...(await wp(req.sess, 'GET', '/config')), ia: aiEnabled() })));
  // Description proposée par l'assistant : photo (facultative) + nom ; rien n'est enregistré, le client remplit le formulaire
  api.post('/ia/description', auth, upload.single('photo'), wrap(async (req, res) => {
    const line = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
    const titre = line(req.body?.titre, 80);
    if (titre.length < 2) throw new HttpError(400, 'Indiquez d’abord le nom de la plante.', 'champ');
    aiLimit(req.sess.id);
    res.json(await describePlant({
      image: req.file?.buffer, mime: req.file?.mimetype, titre,
      categorie: line(req.body?.categorie_label, 60), conditionnement: line(req.body?.conditionnement_label, 30),
    }));
  }));
  // Identification façon Google Lens : la photo principale → jusqu'à 3 noms possibles (l'agriculteur choisit, rien n'est enregistré)
  api.post('/ia/identifier', auth, upload.single('photo'), wrap(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Prenez d’abord une photo de la plante.', 'champ');
    aiLimit(req.sess.id, 'identification');
    res.json(await identifyPlant({ image: req.file.buffer, mime: req.file.mimetype }));
  }));
  api.get('/plantes', auth, wrap(async (req, res) => res.json(await wp(req.sess, 'GET', '/plantes'))));
  api.post('/plantes', auth, plantPhotos, wrap(async (req, res) => res.status(201).json(await wp(req.sess, 'POST', '/plantes', { form: toForm(req) }))));
  api.post('/plantes/:id(\\d+)', auth, plantPhotos, wrap(async (req, res) => res.json(await wp(req.sess, 'POST', `/plantes/${req.params.id}`, { form: toForm(req) }))));
  api.post('/plantes/:id(\\d+)/disponibilite', auth, wrap(async (req, res) => {
    res.json(await wp(req.sess, 'POST', `/plantes/${req.params.id}/disponibilite`, { json: { disponible: req.body?.disponible ? '1' : '0' } }));
  }));
  api.delete('/plantes/:id(\\d+)', auth, wrap(async (req, res) => res.json(await wp(req.sess, 'DELETE', `/plantes/${req.params.id}`))));

  api.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(413).json({ message: 'Photo trop lourde (8 Mo maximum).', code: 'photo' });
    if (err instanceof HttpError || err?.expose) {
      if (err.code === 'session') res.clearCookie(COOKIE, { path: '/agriculteur' });
      return res.status(err.status).json({ message: err.message, code: err.code });
    }
    console.error('Espace agriculteur :', err);
    res.status(500).json({ message: 'Erreur du serveur.' });
  });
  r.use('/api', api);
  return r;
}
