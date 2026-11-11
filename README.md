# Mbayoumkeur — site Node.js + WordPress headless

Boutique sans paiement en ligne : le client compose une **sélection d'articles** et envoie sa commande par **WhatsApp**.

- **Front** : Node.js (Express + EJS) + Tailwind CSS → `mbayoumkeur.shop`
- **Contenu** : WordPress headless (API REST) → `cms.mbayoumkeur.shop`, type de contenu personnalisé **Produit** (pas de WooCommerce)

## Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `WP_URL` | adresse du WordPress | `https://cms.mbayoumkeur.shop` |
| `SITE_NAME` | nom affiché | `Mbayoumkeur` |
| `SHOPS` | points de vente et numéros WhatsApp : `Nom|221XXXXXXXXX;Nom 2|221YYYYYYYYY` | Thiès – Quartier Mbambara (+221 76 864 58 34) ; Grand Mbour (+221 76 941 00 74) |
| `CACHE_SECONDS` | durée du cache du catalogue | `60` |
| `PORT` | port d'écoute | `3000` |

## 1. WordPress : type de contenu Produit

Copier `wordpress/mbayoumkeur-produits.php` dans `wp-content/mu-plugins/` du WordPress (créer le dossier si besoin).
Il ajoute le menu **Produits**, la taxonomie **Catégories de produits** et les champs `prix` (FCFA), `unite`, `disponible`, tous exposés dans l'API REST.

Chaque produit : titre, description, **image à la une**, catégorie, et champs personnalisés `prix` / `unite`.

Catégories prévues : Herbes aromatiques · Plantes comestibles · Arbres fruitiers · Terreaux et substrat · Accessoires de jardinage.

Données d'exemple (3 produits par catégorie) : créer un *mot de passe d'application* (Utilisateurs › Profil), puis :

```bash
WP_USER=admin WP_APP_PASSWORD="xxxx xxxx xxxx xxxx" npm run seed
```

Tant que WordPress n'a aucun produit, le site affiche les produits de démonstration de `data/demo-products.json`.

## 1 bis. WordPress : optimisation des images

Le fichier `images.php` est chargé par le chargeur protégé `mbayoumkeur-agriculteurs.php` (voir « Installation côté WordPress » plus bas) : rien d'autre à copier.

- **À l'envoi** (téléphone d'un agriculteur, médiathèque, API) : photo redressée, réduite à 1600 px, convertie en **WebP** (JPEG optimisé si le serveur ne sait pas faire de WebP) et **débarrassée de ses métadonnées, position GPS comprise**. En cas de panne, l'original est conservé : un envoi n'échoue jamais à cause de l'optimisation.
- **Tailles générées** : `mbk-400`, `mbk-800`, `mbk-1200` et la vignette de l'administration (les tailles WordPress inutiles ne sont plus créées). Le site Node s'en sert pour `srcset` ; les anciennes images (sans ces tailles) continuent de s'afficher.
- **Images déjà en ligne** : *Outils › Optimiser les images* (case « Simulation » pour voir le gain avant), ou en ligne de commande :

```bash
wp mbk-images optimize --dry-run     # simulation
wp mbk-images optimize               # traite tout, originaux gardés dans wp-content/mbk-originals (privé)
```

Une fois le résultat vérifié sur le site, `wp-content/mbk-originals` peut être supprimé pour récupérer l'espace.
Réglages (dans `wp-config.php`) : `MBK_IMG_MAX` (1600), `MBK_IMG_QUALITY_WEBP` (78), `MBK_IMG_QUALITY_JPEG` (80).

## 1 ter. Espace agriculteur (application mobile)

Application installable (PWA) sur `/agriculteur` : l'agriculteur se connecte avec **son compte WordPress** (rôle « Agriculteur »), voit **ses** plantes, en ajoute depuis le terrain (appareil photo, nom, catégorie, prix, conditionnement, stock), enregistre un brouillon ou publie. La photo est réduite sur le téléphone avant l'envoi (WebP, 1600 px, sans GPS).

- **WordPress** (installation) : dans `wp-content/mu-plugins/`, copier **à la racine** le seul fichier `wordpress/mbayoumkeur-agriculteurs.php` (le chargeur) et, **dans le dossier `mbayoumkeur-agriculteurs/`**, les quatre fichiers `core.php`, `backoffice.php`, `api.php` et `images.php` (plus le dossier `assets/`). ⚠️ Ces quatre fichiers ne doivent **jamais** être à la racine de `mu-plugins/` : WordPress les chargerait deux fois et le site afficherait « erreur critique ». Le chargeur est un disjoncteur : un fichier absent ou fautif est mis de côté automatiquement (le reste du site continue), un message s'affiche dans l'administration, et il est réessayé dès que le fichier est remplacé (les messages sont dans `wp-content/mbk-loader-state/`). L'API `mbk/v1` (connexion, plantes, stock) exige un site en **HTTPS** et des comptes agriculteur créés par l'administrateur.
- **Node** : définir `FARMER_SECRET` (32 caractères minimum, secret) dans les variables d'environnement. Sans elle, une clé temporaire est utilisée et les sessions sautent à chaque redémarrage.
- **Sécurité** : le mot de passe d'application de l'agriculteur reste chiffré dans un cookie `httpOnly` (jamais visible par le navigateur) ; essais de connexion limités côté Node et côté WordPress ; un agriculteur ne peut lire ni modifier que ses plantes.
- **Description par l'IA** : le bouton « Décrire avec l'assistant » propose une description et des conseils d'entretien à partir de la photo et du nom (l'agriculteur relit et corrige toujours). **Gratuit avec Gemini** : créer une clé sur https://aistudio.google.com/apikey (compte Google, sans carte bancaire) et la définir dans ``GEMINI_API_KEY`` côté Node ; sans clé, le bouton n'apparaît pas. Modèles par défaut, essayés dans cet ordre si le quota ou la disponibilité du précédent fait défaut : ``gemini-3.1-flash-lite`` (2 à 3 s par photo), ``gemini-3.5-flash-lite`` puis ``gemini-3.6-flash`` (réglable avec ``GEMINI_MODELS``). Les limites du palier gratuit s'affichent dans Google AI Studio. **Attention** : sur le palier gratuit, Google peut utiliser les contenus envoyés (photo de la plante, nom) pour améliorer ses produits ; aucune donnée personnelle n'est envoyée. Claude reste possible en option (``ANTHROPIC_API_KEY``, payant ; ``AI_PROVIDER=anthropic`` pour le forcer). Limites propres à l'application : 6 demandes par minute et 30 par jour et par agriculteur.
- **Hors connexion** : sans réseau (ou si le serveur ne répond pas), ce que l'agriculteur enregistre (nouvelle plante avec photo, modification, bascule en stock) est gardé sur son téléphone (IndexedDB) et envoyé tout seul au retour du réseau : à l'ouverture de l'application, au retour de la connexion, toutes les 20 secondes tant qu'il reste quelque chose, ou avec le bouton « Envoyer maintenant ». Chaque création porte une clé unique (`cle`) : un renvoi après une réponse perdue ne crée jamais de doublon (côté WordPress, `api.php` à jour requis). Un enregistrement refusé par le serveur reste visible avec son message pour être corrigé. L'application s'ouvre aussi sans réseau avec la dernière liste connue. Limites : l'envoi se fait application ouverte (pas en tâche de fond), retirer une plante et l'assistant IA demandent le réseau, les photos des plantes déjà en ligne ne s'affichent pas sans réseau (remplacées par l'icône de leur catégorie).
- **Accès** : lien « Espace agriculteurs » dans le pied de page du site, et adresses courtes ``/agriculteurs`` et ``/producteurs`` (redirigent vers ``/agriculteur``), faciles à dicter ou à envoyer par WhatsApp.
- **Installation sur le téléphone** : ouvrir `/agriculteur` dans Chrome puis « Ajouter à l'écran d'accueil ».
## 2. Lancer en local

```bash
npm install
npm run dev          # http://localhost:3000
```

ou avec Docker : `docker compose up -d --build` → http://localhost:8081

## 3. Déploiement (Hostinger, application Node.js)

- Dépôt : ce repo, branche `main`
- Commande de build : `npm run build` — démarrage : `npm start` (`src/server.js`)
- Les deux points de vente sont déjà configurés par défaut ; `SHOPS` et `WP_URL` ne sont à définir que pour les changer.
