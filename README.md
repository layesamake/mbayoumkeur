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
