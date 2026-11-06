# SMTR — Groupe Sinocet Electronics

**Système de Management & Suivi en Temps Réel.** Première base de code **mobile-first**, tirée du catalogue d'interfaces CDC-SINOCET-2026-001 v3.1. Les maquettes sont un référentiel de conception, pas une preuve de fonctionnalités livrées.

## Démarrage

Prérequis : Node.js 20.19+ (ou 22+), npm.

1. Depuis la racine du dépôt : `cd smtr`
2. Installer les dépendances : `npm install`
3. Copier `.env.example` en `.env.local` et configurer `VITE_SMTR_API_BASE_URL` vers une API autorisée.
4. Lancer : `npm run dev`. Sur mobile, ouvrir l'adresse réseau de l'ordinateur uniquement sur un réseau de développement maîtrisé.
5. Vérifier : `npm run test` et `npm run build`.

Pour prévisualiser **uniquement la structure des écrans sans données** en mode développement, ajouter `?preview=agent`, `?preview=manager` ou `?preview=director`. L'aperçu est désactivé dans le build de production et n'effectue aucune opération. Il ne crée ni comptes, ni ventes.

## Architecture actuelle

`smtr/src/api.ts` est l'unique adaptateur réseau. Le navigateur **ne parle jamais directement à une base SQL**. `src/permissions.ts` gère la visibilité UX par rôle, **sans remplacer** les contrôles d'accès côté serveur.

- **Direction (2FA obligatoire sur l'API)** : vue globale, supervision, utilisateurs, audit, rapports.
- **Manager** : stock central, transferts et validation de réception, inventaire, validations sensibles.
- **Agent** : vente, mon stock, réception, dettes clients, caisse, SAV.
- **Transverse** : SAV, dettes, rapports, selon les permissions effectives renvoyées par l'API.

Le design est conçu pour la consultation debout sur téléphone : navigation basse persistante, zones tactiles >= 44 px, contraste élevé, listes sous forme de cartes sur mobile et tableaux à partir d'un écran large.

## API attendue (contrat de démarrage, pas encore implémentée)

Base configurable, par défaut `/smtr/api/v1`. Réponses JSON, erreurs avec `message`, autorisation Bearer. L'API devra définir et faire respecter :

- `POST /auth/login` avec `{ email, password }` -> `{ accessToken, user: { id, name, role, twoFactorVerified } }`. Une authentification DG est refusée tant que `twoFactorVerified` n'est pas vraie. Le token d'accès reste **en mémoire**, jamais dans `localStorage`.
- `GET /dashboard/summary` -> `{ metrics: [{ id, label, value, hint? }] }`. Les montants ne sont **jamais fabriqués**.
- `GET /stocks`, `/transfers`, `/sales`, `/debts`, `/cases`, `/reports`, `/audit/events`, `/users` -> `{ items: [{ id, title, subtitle?, status?, meta? }] }`. Ces objets sont des **projections sécurisées** : pas d'IMEI complet ou de données personnelles pour un rôle non autorisé.

Les endpoints ci-dessus sont des contrats projetés pour une première intégration ; ils doivent être alignés sur les modèles métier et les conventions d'authentification retenus avant développement des services.

### Ce qui n'est pas encore livré

Aucun service backend, aucune connexion réelle, aucune migration de base, aucune synchronisation WebSocket, aucun paiement, aucune exportation PDF/Excel, aucune vente ou réception modifiant le stock, aucune authentification 2FA et **aucune vente hors ligne** ne sont implémentés dans cette première version. Les boutons d'actions sensibles ne sont pas proposés tant que les règles transactionnelles et d'idempotence ne sont pas opérationnelles.

## Prochain lot fonctionnel

1. Authentification sécurisée et 2FA DG, permissions et filtres de périmètre côté API.
2. Modèle produit/format/IMEI, entrepôt central/agent/transit/SAV et journal des mouvements.
3. Transfert central vers agent : réservation atomique, état *En transit*, réception explicite avant entrée dans le stock vendable.
4. POS : vente depuis le stock réellement disponible, prix figés, paiement comptant/crédit et caisse.
5. SAV : entrepôt virtuel « Ramba » pour retours pour défaut d'usine, **jamais** catégorie d'achat fournisseur.
6. Créances, échéances, rapports et audits immuables ; puis synchronisation hors ligne **sécurisée**.

## Sécurité

Toutes les actions de stock, ventes, crédits et SAV doivent être autorisées et transactionnelles sur le serveur. Les permissions de navigation ne valent jamais autorisation. Le journal d'audit doit être append-only ; l'identification utilisateur, l'horodatage, la provenance de la requête et le détail avant/après sont à enregistrer côté serveur. Les secrets et données financières ne doivent pas être introduits dans le code source.
