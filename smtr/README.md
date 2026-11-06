# SMTR — Groupe Sinocet Electronics

**Système de Management & Suivi en Temps Réel.** Implémentation en cours, à partir du document utilisateur **SMTR Sinocet Catalogue Maquettes.pdf, CDC-SINOCET-2026-001, v3.1**.

## Interfaces fidèles aux maquettes

Les écrans opérationnels reprennent les intitulés, la hiérarchie des blocs et les couleurs du catalogue : **page 11 Stock Central**, **page 12 Nouveau transfert — Central → Agent**, **page 17 Valider une réception (Agent)**. Les maquettes du PDF sont la référence de conception. L'interface peut être consultée sur téléphone (navigation basse) ou ordinateur (navigation latérale).

Aucune donnée d'activité artificielle n'est insérée. L'aperçu visuel temporaire sans données n'existe que dans le serveur de développement (`?preview=agent`, `?preview=manager`, `?preview=director`) et n'active aucune transaction.

## Développement local

Prérequis : Node.js 22+, MySQL 8+, npm. Démarrer depuis la racine de `smtr/` :

### 1. API et MySQL

- Créer **une base vide** MySQL 8 et un utilisateur SQL dédié, avec les droits nécessaires uniquement à cette base.
- `cd api` ; `npm install`
- Copier `.env.example` → `.env` et renseigner `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` et `SMTR_TOTP_ENCRYPTION_KEY` (une clé privée aléatoire de **64 caractères hexadécimaux**, non stockée dans Git).
- `npm run migrate` : crée les tables, les trois rôles de système, aucun compte utilisateur ni produit fictif.
- Configurer un entrepôt réel et les comptes autorisés : voir [instructions API](api/README.md).
- `npm run dev` : serveur API à `http://localhost:4010/smtr/api/v1` par défaut.

### 2. Frontend

Dans un second terminal, depuis `smtr/` :

- `npm install` puis `npm run dev`.
- Ouvrir `http://localhost:5173/smtr/`. Vite relaie les appels locaux `/smtr/api/v1` vers le serveur API.
- `npm run test` et `npm run build` pour les contrôles frontend.

**Important :** les tokens d'accès restent en mémoire du navigateur, jamais dans `localStorage`. La session expire à la fermeture/au rechargement de la page (une nouvelle connexion est nécessaire). Les autorisations réelles sont appliquées dans l'API ; la navigation ne confère aucun privilège.

## Périmètre fonctionnel déjà codé

- Authentification : mots de passe Argon2id, sessions opaques hachées en base et révocables, blocage temporaire après tentatives erronées, 2FA/TOTP pour la Direction.
- Produits et exemplaires : réception manager au stock central, IMEI uniques au niveau SQL, contrôle de format et de collision, stock agent cloisonné.
- Transfert Central → Agent : sélection d'IMEI disponibles, réservation transactionnelle, état **IN_TRANSIT** ; IMEI non vendables pendant le transport.
- Réception agent : validation de **tous** les IMEI attendus avant mouvement vers son stock, strictement réservée à l'agent destinataire et protégée contre les doublons.
- Écart : signalement avec liste des articles vérifiés, passage à **DISCREPANCY**, gel **HOLD** des exemplaires concernés, journal d'audit. Une résolution managériale et un retour physique vérifié restent à développer.

Les données brutes d'IMEI ne sont pas renvoyées à l'UI : seulement leurs derniers chiffres. L'agent ne voit pas les marges/prix d'achat et ne peut pas rechercher le stock central.

## Ce qui reste non implémenté

Ventes et factures, crédit, caisse, opérations SAV/Ramba complètes, inventaires tournants, exports PDF/Excel, synchronisation WebSocket, clôture managériale d'un écart, connexion hors ligne et PWA hors ligne. Aucun bouton ne doit simuler leur succès.

La connexion à de vraies données et le déploiement de production demandent : revue du cahier des charges complet, validation des droits utilisateurs et des entrepôts réels, sauvegarde MySQL, HTTPS, gestion des secrets et stratégie de migrations versionnées. Ce code constitue **une première livraison de développement**, non une mise en production.

Voir [Référence PDF](docs/FIDELITE_PDF.md) et [contrat API](api/README.md).
