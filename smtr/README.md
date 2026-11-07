# SMTR — Groupe Sinocet Electronics

Système de Management & Suivi en Temps Réel. Les écrans suivent le catalogue utilisateur **CDC-SINOCET-2026-001 v3.1** : Direction, Manager, Agent mobile-first et modules transverses. Voir [correspondance PDF](docs/FIDELITE_PDF.md), [API et exploitation locale](api/README.md) et [validation](docs/VALIDATION.md).

## Fonctionnalités

- Authentification Argon2id, sessions opaques révocables, limitation de connexion et TOTP obligatoire Direction/Administrateur.
- Administrateur : comptes, permissions, menus par rôle, paramètres techniques et audit de configuration. Les droits sont relus sur chaque requête ; la révocation invalide les sessions concernées. Les accès techniques et commerciaux restent séparés côté serveur.
- Direction : indicateurs consolidés, marge réelle, tarification, plafonds de crédit agents et supervision des stocks.
- Manager : stock central, lots IMEI et import Excel, transferts, résolution physique des écarts, inventaires tournants, validations avec code privé, SAV/Ramba et rapports.
- Agent : stock personnel, réception complète, ventes comptant/crédit/partielles, clients, remboursements, reçus PDF et clôture quotidienne de caisse.
- SAV : défaut d’usine exclusivement, isolement non vendable, réparation avec remise en stock vérifiée, échange et remboursement approuvés. L’appareil actuellement associé à une vente est distingué de l’IMEI historique de sa facture.
- Rapports PDF/Excel : ventes, Stock Initial vs Réel, SAV mensuel et dettes, avec filtres de période et d’agent.
- Actualisation WebSocket par ticket à usage unique ; les événements contiennent une invalidation, pas de données commerciales.
- PWA : cache du shell et brouillons de vente IndexedDB. Un brouillon hors ligne ne réserve aucun IMEI, ne génère aucun reçu et reste soumis aux validations serveur lors de sa soumission après reconnexion.

## Développement

Prérequis : Node.js 22+, npm, MySQL 8. Créer une base dédiée puis renseigner `smtr/api/.env` à partir de `.env.example`. `SMTR_TOTP_ENCRYPTION_KEY` doit contenir 64 caractères hexadécimaux privés.

Dans `smtr/api` : `npm ci`, `npm run migrate`, puis `npm run dev` (port 4010). Les migrations sont vérifiées et enregistrées instruction par instruction ; une migration appliquée ne doit pas être modifiée. Aucun compte, produit ou mouvement fictif n’est créé par ces migrations.

Provisionner les comptes initiaux et les entrepôts CENTRAL/SAV avec `api/scripts/provision.mjs` dans un terminal privé. Les comptes Direction/Administrateur doivent enrôler leur TOTP avant connexion. Les Agents reçoivent un entrepôt personnel ; les Managers ont un code de validation à six chiffres.

Dans `smtr` : `npm ci`, `npm run dev`, puis ouvrir `http://localhost:5173/smtr/`. Pour une API de recette sur un autre port, définir `SMTR_DEV_API_TARGET` avant Vite. Les aperçus `?preview=agent`, `manager`, `director` ou `admin` sont limités au serveur de développement et n’activent aucune transaction.

## Vérification

- Web : `npm test` puis `npm run build`.
- API : `npm run check`, `npm run migrate` deux fois, puis `npm test`.
- Les tests API détruisent leurs données de test et refusent une base dont le nom ne finit pas par `_qa` ou `_test`. Utiliser un utilisateur SQL dédié, jamais une base d’activité réelle.

## Sessions, données et limites hors ligne

Les jetons restent en mémoire ; ils ne sont pas stockés dans `localStorage`, IndexedDB ou le service worker. Un rechargement impose une nouvelle connexion en ligne. Les brouillons sont filtrés par compte et ne stockent ni mot de passe, ni jeton, ni nom client, ni téléphone, ni IMEI complet. Les paiements Mobile Money sont enregistrés après confirmation manuelle ; cette application ne déclenche pas de débit opérateur.

Le scanner caméra utilise `BarcodeDetector` lorsque le navigateur le prend en charge, avec saisie/recherche en secours. HTTPS est nécessaire pour la caméra hors localhost. Le cache hors ligne ne contient jamais de réponses API.

## Livraison

Aucun déploiement de production n’est effectué par cette livraison. Avant ouverture : configurer les comptes/entrepôts réels, HTTPS, les secrets, les sauvegardes et le proxy HTTP/WebSocket. Servir `smtr/dist` sous `/smtr/`, l’API sous `/smtr/api/v1` et les connexions WebSocket sous `/smtr/ws`.
