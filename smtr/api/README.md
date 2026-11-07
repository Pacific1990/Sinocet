# API SMTR

Node.js 22+, MySQL 8, Express. Copier `.env.example` vers `.env`, renseigner la base et la clé `SMTR_TOTP_ENCRYPTION_KEY` (64 caractères hexadécimaux), puis `npm ci`, `npm run migrate` et `npm start`. Port par défaut : 4010.

## Comptes initiaux et entrepôts

`scripts/provision.mjs` utilise des variables d’environnement temporaires dans un terminal privé. Ne versionner aucun mot de passe, PIN ou secret TOTP.

- `SMTR_PROVISION_ACTION=warehouse`, `SMTR_WAREHOUSE_KIND=CENTRAL` ou `SAV`, `SMTR_WAREHOUSE_NAME`, éventuellement `SMTR_WAREHOUSE_LOCATION`.
- `SMTR_PROVISION_ACTION=user`, `SMTR_USER_ROLE=admin|director|manager|agent`, `SMTR_USER_NAME`, `SMTR_USER_EMAIL`, `SMTR_USER_PASSWORD` (12 caractères minimum).
- Agent : ajouter `SMTR_AGENT_WAREHOUSE_NAME` pour créer son stock dédié.
- Manager : ajouter un code privé de six chiffres dans `SMTR_MANAGER_APPROVAL_CODE`.
- Direction/Administrateur : le script imprime une fois l’URI OTPAuth à enrôler avant connexion. Le secret est chiffré en base ; ne pas envoyer cet URI à un service tiers.

L’Administrateur peut ensuite créer les Managers/Agents et gérer les comptes, les permissions, les menus et les paramètres techniques. L’enrôlement des comptes Direction/Administrateur reste réservé au terminal privé. Les migrations créent seulement le schéma et les référentiels de rôles, permissions, menus et paramètres ; aucune activité fictive.

## Contrat HTTP

Préfixe `/smtr/api/v1`. Les routes privées exigent `Authorization: Bearer <token>`. La session est opaque, hachée en base, limitée à huit heures et révocable. Les permissions sont relues sur chaque requête et complétées par les contrôles métier de rôle et de propriétaire.

| Méthode | Route | Usage |
|---|---|---|
| GET | `/health` | Santé MySQL |
| POST | `/auth/login` | Email, mot de passe et `otp` si nécessaire |
| GET / POST | `/auth/me`, `/auth/logout`, `/auth/change-password` | Profil, révocation, mot de passe |
| GET | `/access/me` | Permissions et menus effectifs |
| GET | `/dashboard/summary`, `/dashboard/overview` | Indicateurs selon le rôle |
| GET | `/stocks`, `/stocks/products`, `/stocks/agents`, `/stocks/central-warehouses`, `/stocks/items` | Stock autorisé, catalogues et recherche |
| POST | `/stocks/products`, `/stocks/receipts`, `/stocks/import` | Références, lots IMEI, Excel multipart `file` |
| GET / POST | `/transfers` | Historique / envoi idempotent avec `requestId` UUID |
| GET | `/transfers/pending`, `/transfers/:id` | Réceptions attendues / détail autorisé |
| POST | `/transfers/:id/receive`, `/transfers/:id/discrepancy`, `/transfers/:id/resolve` | Réception complète, écart, retour physique vérifié |
| GET / POST | `/sales` | Historique / vente Agent avec clé `requestId` |
| GET | `/sales/stock`, `/sales/:id/receipt` | Articles vendables de l’Agent / reçu PDF autorisé |
| GET / POST | `/customers` | Clients du périmètre / création |
| PATCH | `/customers/:id/limit` | Plafond client autorisé |
| GET | `/debts`, `/debts/:id/reminder` | Dettes et rappel prérempli |
| POST | `/debts/:id/payments` | Remboursement idempotent |
| GET | `/payments/:id/receipt` | Reçu de paiement PDF |
| GET / POST | `/cash/today`, `/cash/history`, `/cash/close` | Situation, historique et clôture unique journalière |
| GET / POST | `/approvals`, `/approvals/mine` | File Manager, demandes Agent et ses décisions |
| POST | `/approvals/:id/decision`, `/approvals/sales/:id/cancel` | Code Manager, approbation et retour physique |
| GET / POST | `/inventories`, `/inventories/agents`, `/inventories/start` | Inventaires et gel ciblé |
| GET / POST | `/inventories/:id`, `/inventories/:id/close` | Comptage et clôture |
| POST | `/inventories/:id/reconcile`, `/inventories/warehouses/:id/freeze` | Rapprochement IMEI et gel/dégel contrôlé |
| GET / POST | `/cases` | Dossiers du périmètre / retour Agent pour défaut usine |
| GET | `/cases/warehouse` | Ramba isolé non vendable |
| POST | `/cases/:id/start`, `/cases/:id/resolve`, `/cases/:id/release` | Traitement, décision approuvée, remise en stock après vérification |
| GET | `/reports`, `/reports/:kind?format=pdf|xlsx&from=YYYY-MM-DD&to=YYYY-MM-DD&agentId=…` | `sales`, `stock_variance`, `sav_monthly`, `debts` |
| GET / POST / PATCH | `/users`, `/users/:id`, `/users/:id/approval-code` | Comptes et code Manager, Administrateur uniquement |
| GET / PATCH | `/finance/agents`, `/finance/agents/:id/limit` | Plafonds agents, Direction uniquement |
| GET / PATCH | `/settings`, `/settings/products/:id` | Lecture produits ; tarification réservée Direction |
| GET | `/supervision`, `/supervision/:id/items`, `/audit/events` | Supervision et journal métier |
| GET / PUT | `/system/roles`, `/system/permissions`, `/system/roles/:role/permissions` | Matrice des permissions |
| GET / PUT | `/system/menus`, `/system/roles/:role/menus` | Visibilité et ordre des menus |
| GET / PUT | `/system/settings`, `/system/settings/:key` | Paramètres techniques non secrets |
| GET | `/system/overview`, `/system/audit` | Tableau de bord et journal techniques |
| POST | `/events/ticket` | Ticket WebSocket à usage unique, validité 45 s |

WebSocket `/smtr/ws?ticket=…` : origine autorisée et ticket consommé à l’ouverture. Événements `connected` et `refresh`, sans données financières. Le client relit ensuite les ressources via l’API autorisée.

## Invariants

- IMEI unique ; réservations transactionnelles et contrôles serveur sur chaque vente/réception.
- Transit, gel et Ramba ne sont jamais vendables. L’écart nécessite un rapprochement physique avant libération.
- Agent : son stock, ses clients, dettes et opérations ; aucun coût d’achat ni marge dans ses réponses.
- Vente, remboursement et clôture se synchronisent sur le compte Agent ; une caisse clôturée refuse les nouvelles opérations du jour.
- Plafonds client et Agent vérifiés en transaction ; l’Agent enregistre les paiements sans éditer le solde de dette.
- `sales.item_id` conserve l’IMEI de la facture ; `items.current_sale_id` suit le propriétaire courant et les échanges SAV. Une ancienne vente ne peut ni annuler ni reprendre un appareil revendu.
- Réparations, échanges et remboursements SAV nécessitent une décision approuvée. Une réparation résolue reste en HOLD jusqu’au contrôle physique de remise en stock.
- Audit horodaté, acteur, IP et détails avant/après ; triggers SQL interdisant UPDATE/DELETE des traces.
- Les exports Excel neutralisent les cellules interprétables comme formules ; les reçus PDF n’incluent aucun coût d’achat.

## Migrations et tests

`npm run migrate` applique `001_core.sql` à `009_current_sale.sql` avec verrou MySQL et empreintes de chaque instruction. Relancer est autorisé ; modifier une instruction déjà appliquée est refusé. Les DDL MySQL ne sont pas transactionnelles : sauvegarder avant migration réelle et examiner toute interruption avant reprise.

`npm run check` puis `npm test`. Les tests exigent une base isolée suffixée `_test` ou `_qa` et en effacent les données. Ne jamais utiliser le compte ni la base d’exploitation. La CI crée MySQL 8 et vérifie deux exécutions successives des migrations.

Pour l’exploitation future : HTTPS, proxy `/smtr/api/v1` et `/smtr/ws`, `SMTR_ALLOWED_ORIGIN`, sauvegarde/restauration, secrets privés et comptes SQL aux droits adaptés. Aucun déploiement de production n’est inclus.
