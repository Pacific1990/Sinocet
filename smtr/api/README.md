# API SMTR — Authentification, stocks IMEI et transferts

> Implémentation initiale, **pas un serveur de production certifié**. Node.js 22+, MySQL 8.0+, environnement HTTPS et base dédiée.

## Installation

`npm install`, renseigner `.env` depuis `.env.example`, puis `npm run migrate` (schéma `sql/001_core.sql`). `npm run start` écoute sur `SMTR_PORT` (4010).

**Aucune donnée métier ni identité n'est semée automatiquement.** Les seules lignes automatiques sont les rôles statiques `director`, `manager` et `agent`.

### Préparer les identités

L'outil `scripts/provision.mjs` est réservé à un terminal d'exploitation **privé**. Utiliser des variables d'environnement locales temporaires (ne pas conserver les mots de passe dans l'historique shell ni dans un fichier versionné).

- `SMTR_PROVISION_ACTION=warehouse`, `SMTR_WAREHOUSE_KIND=CENTRAL` et `SMTR_WAREHOUSE_NAME=<nom réel du dépôt>` puis `node scripts/provision.mjs` : crée un dépôt central réel.
- `SMTR_PROVISION_ACTION=user`, `SMTR_USER_ROLE=manager`, `SMTR_USER_NAME`, `SMTR_USER_EMAIL`, `SMTR_USER_PASSWORD` (12 caractères minimum), puis `node scripts/provision.mjs` : crée un manager.
- `SMTR_USER_ROLE=agent` nécessite en plus `SMTR_AGENT_WAREHOUSE_NAME=<nom réel du stock agent>`. L'outil crée une réserve agent dédiée.
- `SMTR_USER_ROLE=director` crée un secret TOTP chiffré AES-256-GCM et imprime **une seule fois** un URI OTPAuth permettant son enrôlement dans une application d'authentification ; le conserver confidentiel.

Avant tout usage réel : sécuriser les postes administrateurs, la configuration DB et les procédures de récupération des facteurs TOTP.

## HTTP sous /smtr/api/v1

Toutes les réponses sont JSON ; chaque route métier exige `Authorization: Bearer <token>`. Un jeton est aléatoire, stocké haché en MySQL, expirant après huit heures et révocable via déconnexion. L'écran d'accueil ne mémorise pas le jeton dans le navigateur.

| Méthode | Route | Rôle | Action |
|---|---|---|---|
| POST | `/auth/login` | Public avec identifiants | Email + mot de passe + `otp` si 2FA |
| GET / POST | `/auth/me` / `/auth/logout` | Authentifié | Profil restreint / révocation |
| GET | `/dashboard/summary` | Tous | Indicateurs calculés uniquement sur données existantes |
| GET | `/stocks` | Tous | Agent : son stock ; Manager/Direction : central |
| GET | `/stocks/central-warehouses` | Manager/Direction | Dépôts réellement enregistrés |
| GET | `/stocks/agents` | Manager/Direction | Agents actifs et réserves attribuées |
| GET | `/stocks/products` | Manager/Direction | Références produits |
| POST | `/stocks/products` | Manager/Direction | Créer une référence ; interdit la catégorie « Ramba » |
| GET | `/stocks/items?warehouseId=<id>&q=<terme>` | Manager/Direction | Recherche limitée aux IMEI disponibles au central ; IMEI masqués |
| POST | `/stocks/receipts` | Manager/Direction | Entrée d'un lot par IMEI, transactionnelle et anti-doublon |
| GET | `/transfers` | Tous | Manager/Direction : tous ; agent : uniquement les siens |
| GET | `/transfers/pending` | Agent | Transferts entrants à vérifier |
| GET | `/transfers/:id` | Tous selon droits | Détail masqué |
| POST | `/transfers` | Manager/Direction | Envoyer un lot vers un agent (clé idempotente `requestId` UUID) |
| POST | `/transfers/:id/receive` | Agent destinataire | Vérifier chaque IMEI ; passage au stock agent atomique |
| POST | `/transfers/:id/discrepancy` | Agent destinataire | Signalement : HOLD pour tous les articles en cause |

### Invariants essentiels

- `items.imei` est unique en base et l'entrée en stock refuse un IMEI qui existe déjà.
- `items.state=AVAILABLE` seulement dans un entrepôt opérationnel. Les IMEI d'un transfert passent à `IN_TRANSIT` avant de quitter le central, puis à `AVAILABLE` **chez l'agent seulement après validation complète**.
- Un article en transit ou placé en `HOLD` ne peut pas être transféré à nouveau.
- L'agent n'a accès qu'aux mouvements qui lui sont destinés et à son propre stock.
- Un transfert ne peut pas être réceptionné partiellement. Les écarts passent en `DISCREPANCY` et les articles en `HOLD` jusqu'à un retour vérifié par le Manager (résolution à coder).
- Une requête de transfert rejouée avec la même clé et les mêmes articles ne crée pas de second mouvement.
- Les traces d'audit `logs` sont alimentées côté serveur, sans stocker le texte complet des IMEI dans les réponses.
- Le stock SAV/Ramba est **non vendable** et non référencé comme achat fournisseur.

## Tests

`npm run check` contrôle la syntaxe. `npm run migrate` est idempotent. `npm test` exécute les tests TOTP, sécurité, rôles, concurrence, transfert et réception sur une **base MySQL de test isolée** préparée par la CI ; ne jamais lancer ces tests contre une base réelle (ils suppriment les données des tables de test au démarrage).

## Points de déploiement à traiter

- Reverse proxy HTTPS : `/smtr/` pour la SPA et `/smtr/api/v1` pour l'API ; définir correctement les chemins.
- Droits SQL minimaux pour le compte runtime ; comptes DDL séparés. TLS MySQL/stockage chiffré/backup/restauration à configurer.
- Habilitations en exploitation (directeur/manager/agent), gestion du renouvellement de sessions et procédure de récupération 2FA.
- Revue de sécurité externe, monitoring, journal d'événements central et sauvegardes.
- Résolution des écarts, ventes/caisses/dettes, intégration scan réel, synchronisation WebSocket et PWA hors ligne.
