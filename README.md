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

- **WordPress** (installation) : dans `wp-content/mu-plugins/`, copier **à la racine** le seul fichier `wordpress/mbayoumkeur-agriculteurs.php` (le chargeur) et, **dans le dossier `mbayoumkeur-agriculteurs/`**, les six fichiers `core.php`, `backoffice.php`, `api.php`, `images.php`, `mobile.php` et `doublons.php` (plus le dossier `assets/`). ⚠️ Ces quatre fichiers ne doivent **jamais** être à la racine de `mu-plugins/` : WordPress les chargerait deux fois et le site afficherait « erreur critique ». Le chargeur est un disjoncteur : un fichier absent ou fautif est mis de côté automatiquement (le reste du site continue), un message s'affiche dans l'administration, et il est réessayé dès que le fichier est remplacé (les messages sont dans `wp-content/mbk-loader-state/`). L'API `mbk/v1` (connexion, plantes, stock) exige un site en **HTTPS** et des comptes agriculteur créés par l'administrateur.
- **Node** : définir `FARMER_SECRET` (32 caractères minimum, secret) dans les variables d'environnement. Sans elle, une clé temporaire est utilisée et les sessions sautent à chaque redémarrage.
- **Sécurité** : le mot de passe d'application de l'agriculteur reste chiffré dans un cookie `httpOnly` (jamais visible par le navigateur) ; essais de connexion limités côté Node et côté WordPress ; un agriculteur ne peut lire ni modifier que ses plantes.
- **Description par l'IA** : le bouton « Décrire avec l'assistant » propose une description et des conseils d'entretien à partir de la photo et du nom (l'agriculteur relit et corrige toujours). **Gratuit avec Gemini** : créer une clé sur https://aistudio.google.com/apikey (compte Google, sans carte bancaire) et la définir dans ``GEMINI_API_KEY`` côté Node ; sans clé, le bouton n'apparaît pas. Modèles par défaut, essayés dans cet ordre si le quota ou la disponibilité du précédent fait défaut : ``gemini-3.1-flash-lite`` (2 à 3 s par photo), ``gemini-3.5-flash-lite`` puis ``gemini-3.6-flash`` (réglable avec ``GEMINI_MODELS``). Les limites du palier gratuit s'affichent dans Google AI Studio. **Attention** : sur le palier gratuit, Google peut utiliser les contenus envoyés (photo de la plante, nom) pour améliorer ses produits ; aucune donnée personnelle n'est envoyée. Claude reste possible en option (``ANTHROPIC_API_KEY``, payant ; ``AI_PROVIDER=anthropic`` pour le forcer). Limites propres à l'application : 6 demandes par minute et 30 par jour et par agriculteur.
- **Recadrer, puis traitement à la publication** : la photo prise reste intacte sur le téléphone ; le bouton « Recadrer » ouvre un éditeur plein écran (glisser pour déplacer, pincer ou curseur pour zoomer, formats Carré, Paysage et Portrait, rotation d'un quart de tour ; aussi disponible sur chaque photo supplémentaire). Au clic sur « Publier » ou « Brouillon », les photos sont **traitées automatiquement** : recadrage, 1600 px au plus, WebP (JPEG sur Safari), sans métadonnées ni position GPS, puis envoyées ; hors connexion, c'est la version déjà traitée (légère) qui est gardée sur le téléphone. L'assistant reçoit une version réduite à 1024 px. **Retouche** : le même éditeur a un onglet « Couleurs » (luminosité, contraste, saturation, aperçu en direct, « Remettre à zéro ») et un format « Original » qui garde les proportions de la photo. **Photos déjà en ligne** : le bouton « Retoucher » (photo principale) ou un appui sur une miniature de la galerie relit la photo en pleine taille (1200 px) par un relais du serveur Node (`GET /agriculteur/api/photo?u=…`, limité aux fichiers de la médiathèque du WordPress configuré, car le navigateur ne peut pas lire l'autre domaine), ouvre l'éditeur, et seulement si l'agriculteur valide, la photo retouchée remplace l'ancienne à l'enregistrement : `api.php` supprime alors l'ancienne photo principale si elle appartenait à cette plante et n'est pas dans sa galerie (aucun média orphelin, une photo rattachée ailleurs n'est jamais touchée) ; en galerie, l'ancienne est retirée et la nouvelle ajoutée. Cela demande le réseau (message clair hors connexion). `api.php` expose pour cela `photo_full` et `full`.
- **Retour au site public** : l'écran de connexion (après « Quitter » ou une session expirée) propose « Retour au site Mbayoumkeur » vers la boutique.
- **Anti-doublons** : (1) *à la saisie* : si l'agriculteur a déjà une plante de même nom (comparé sans accents, majuscules ni pluriel : « Papayers » = « papayer ») dans la même catégorie, une alerte s'affiche sous le nom, puis une fenêtre propose « Modifier la plante existante », « Créer quand même » (autre variété) ou « Annuler » ; seul un nouveau nom ou une nouvelle catégorie déclenche l'alerte. (2) *côté serveur* : `api.php` refuse avec une erreur 409 qui renvoie la plante existante (l'application la propose de même, si la liste du téléphone n'était pas à jour), sauf `force=1` ; un renvoi après coupure réseau reste géré par la clé d'envoi. « Papayer nain » n'est pas un doublon de « Papayer ». Deux producteurs peuvent vendre la même plante. (3) *photos* : la même photo envoyée deux fois pour une plante n'est enregistrée qu'une fois (empreinte SHA-1 gardée sur le média). (4) *nettoyage* : **Outils › Doublons de plantes** (administrateur) liste les groupes de même nom et même catégorie, tous producteurs confondus, avec la plante conseillée (publiée, avec photo, mieux décrite) ; « garder la plante cochée » complète ses champs vides (description, nom local, prix, photos) avec ceux des autres puis met les autres **à la corbeille** (restaurable) ; « Ce ne sont pas des doublons » écarte un groupe. Un bandeau signale les groupes sur la liste des plantes. Rien n'est jamais supprimé automatiquement.
- **Plusieurs photos par plante** : la photo principale plus **4 photos supplémentaires au maximum** (5 en tout), prises avec l'appareil ou choisies dans la galerie (plusieurs d'un coup possible), retirables une à une. Elles sont gardées hors connexion comme le reste. Côté WordPress, `api.php` enregistre les identifiants dans la méta `mbk_galerie` et expose le champ public `galerie` ; la fiche produit de la boutique affiche une rangée de miniatures qui remplacent la grande photo.
- **Nom local (wolof)** : champ facultatif saisi par l'agriculteur (méta `nom_local`, champ public `nom_local`). Il s'affiche sur la fiche produit (« Nom local (wolof) : … ») et la recherche de la boutique le trouve. Il n'est volontairement **pas** proposé par l'IA : testé, le modèle invente des noms wolof.
- **Identification de la plante** (façon Google Lens) : à la première photo, si le nom est vide, l'assistant propose jusqu'à 3 noms possibles avec leur nom scientifique et un niveau de confiance ; l'agriculteur touche le bon, ou saisit le nom lui-même. Même fournisseur que la description (Gemini gratuit, clé `GEMINI_API_KEY`), limite de 40 identifications par jour et par agriculteur (6 demandes par minute au total). Toujours une **suggestion** à vérifier.
- **Redirection sur téléphone** (`mobile.php`) : un agriculteur qui se connecte à WordPress depuis un téléphone arrive directement sur l'application (sauf s'il demandait une page précise, par exemple le lien d'un e-mail) ; la liste « Mes plantes » de l'administration ouverte sur téléphone y renvoie aussi (ajouter `&classique=1` à l'adresse pour rester sur la version classique) ; la page de connexion et l'administration affichent un message invitant à utiliser l'application. L'adresse de l'application se règle dans `wp-config.php` : `define('MBK_APP_URL', 'https://…/agriculteur');`.
- **Hors connexion** : sans réseau (ou si le serveur ne répond pas), ce que l'agriculteur enregistre (nouvelle plante avec photo, modification, bascule en stock) est gardé sur son téléphone (IndexedDB) et envoyé tout seul au retour du réseau : à l'ouverture de l'application, au retour de la connexion, toutes les 20 secondes tant qu'il reste quelque chose, ou avec le bouton « Envoyer maintenant ». Chaque création porte une clé unique (`cle`) : un renvoi après une réponse perdue ne crée jamais de doublon (côté WordPress, `api.php` à jour requis). Un enregistrement refusé par le serveur reste visible avec son message pour être corrigé. L'application s'ouvre aussi sans réseau avec la dernière liste connue. Limites : l'envoi en tâche de fond (voir ci-dessous) n'existe que sur Chrome/Edge Android, ailleurs l'envoi se fait application ouverte, retirer une plante et l'assistant IA demandent le réseau, les photos des plantes déjà en ligne ne sont visibles hors connexion que si elles ont été téléchargées avant (voir ci-dessous), sinon l'icône de leur catégorie s'affiche ; retoucher une photo en ligne demande le réseau.
- **Dictée vocale** : un bouton « Dicter » sous la description et sous les conseils d'entretien utilise la reconnaissance vocale du navigateur (`SpeechRecognition`, en français, Chrome/Edge sur Android et Safari récent ; le bouton n'est pas affiché ailleurs, le micro du clavier reste possible). Le texte s'écrit à la suite de ce qui est déjà saisi, en direct, avec une majuscule en début de champ ; on peut dire « virgule », « point final », « point d'interrogation », « point d'exclamation » et « à la ligne ». Elle repart seule après un silence tant qu'on n'a pas appuyé sur « Arrêter la dictée », et s'arrête en quittant l'écran, à l'enregistrement ou au lancement de l'assistant. Elle demande le réseau (le navigateur envoie la voix à son service) et l'autorisation du micro ; des messages clairs expliquent un refus ou l'absence de connexion. Le nom local (wolof) n'est pas dicté : le français ne le reconnaîtrait pas.
- **Envoi en tâche de fond** : quand un enregistrement est mis en attente, l'application enregistre un événement Background Sync (`mbk-flush`) ; dès que le réseau revient, le navigateur réveille le service worker **même application fermée** (Chrome et Edge sur Android) et il envoie la file d'attente gardée dans IndexedDB (`sw.js`, mêmes règles que `app.js` : clé d'unicité des créations, enregistrement refusé gardé avec son message, plante disparue abandonnée). Il ne vérifie que la session déjà ouverte et n'envoie que les enregistrements de l'agriculteur connecté ; session expirée ou réseau absent : rien n'est perdu. Un verrou (`navigator.locks`) évite que l'application ouverte et le service worker envoient en même temps ; à l'ouverture, l'application affiche « envoyé en arrière-plan ». Sans cette API (Safari, Firefox), l'envoi reste celui de l'application ouverte (retour du réseau, toutes les 20 s, bouton « Envoyer maintenant »).
- **Photos visibles hors connexion** : à chaque actualisation de la liste (réseau présent), l'application télécharge les miniatures des plantes (principale et galerie, 400 au plus) par le relais `/agriculteur/api/photo` (même domaine) et le service worker les garde dans le cache `mbk-photos` (cache d'abord, la photo d'une adresse ne change jamais). Une image qui ne charge pas est relue depuis cette copie, puis, à défaut, remplacée par l'icône. Les copies des photos retirées ou remplacées sont supprimées à l'actualisation suivante, et tout le cache à la déconnexion. Environ 20 à 40 Ko par photo.
- **Accès** : lien « Espace agriculteurs » dans le pied de page du site, et adresses courtes ``/agriculteurs`` et ``/producteurs`` (redirigent vers ``/agriculteur``), faciles à dicter ou à envoyer par WhatsApp.
- **Installation sur le téléphone** : ouvrir `/agriculteur` dans Chrome puis « Ajouter à l'écran d'accueil ».
## 1 quater. Polices de caractères

Les polices sont **embarquées** dans `public/fonts/` (aucune requête vers Google : plus rapide, et les visiteurs ne sont pas exposés à un tiers). Site public **et** espace agriculteur : titres en **Fraunces** (serif douce, `font-display`), texte en **Source Sans 3**. Les `@font-face` sont dans `src/input.css` ; seuls les extraits « latin » (français) sont chargés d'office, les extraits « latin-ext » (lettres du wolof comme ŋ) ne le sont que si un de ces caractères apparaît. Les polices de l'espace agriculteur sont gardées par le service worker pour l'usage hors connexion (Fraunces latin et Source Sans 3). Licence SIL OFL 1.1 (`public/fonts/LICENSE.txt`). Pour changer de police : remplacer les fichiers, ajuster `src/input.css` et `tailwind.config.cjs`, puis `npm run build`.

## 1 quinquies. Page FAQ

La page **`/faq`** (« Questions fréquentes ») regroupe 14 questions en 4 rubriques (Commander, Paiement et livraison, Les plantes, Producteurs partenaires), en accordéons natifs `<details>` (accessibles au clavier et sans JavaScript). Le contenu est dans `src/faq.js` : modifier une question ou une réponse se fait là, et la page comme les données structurées `FAQPage` (schema.org, pour les moteurs de recherche) suivent. Les réponses ne décrivent que ce que le site fait (commande par WhatsApp, sans paiement en ligne, livraison organisée après validation) : frais, délais et zones de livraison ne sont pas annoncés, ils sont confirmés par le point de vente ; **à compléter dès que ces règles sont fixées**. Liens vers la FAQ : menu du site (ordinateur), pied de page, page Contact et étape « Commander en trois étapes » de l'accueil. `/questions-frequentes` redirige vers `/faq`.

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
