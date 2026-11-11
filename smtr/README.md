# SMTR — Groupe Sinocet Electronics

SMTR utilise les comptes, entreprises et opérations d’EkoLabs POS. Les écrans Direction, Manager, Agent et Administrateur suivent le catalogue CDC-SINOCET-2026-001 v3.1. [Correspondance avec le catalogue](docs/FIDELITE_PDF.md)

## Validation QA par rôle

Le module **Validation QA** est accessible selon les permissions POS. Il propose un tableau de bord, des scénarios réutilisables, le suivi par compte Playwright, un tableau de parcours, un kanban, les blocages et les dossiers prêts pour validation. Les fiches sont enregistrées côté POS après application de la migration `20261111000100_smtr_qa_validation.js`, sans dates ni résultats inventés.

Voir [Guide de recette et critères d'acceptation](docs/VALIDATION_QA.md) pour les droits de chaque profil, l'usage des preuves, les conditions du statut « Validé » et les tests à exécuter.

## Développement et recette

Démarrer l’API POS avec la base de recette et les migrations POS de cette livraison. Pour le développement local, Vite transmet les requêtes à `http://127.0.0.1:4020` par défaut. Définir `POS_DEV_API_TARGET` si nécessaire.

Dans ce dossier, exécuter `npm ci`, `npm test` et `npm run dev`. Les aperçus de rôles restent réservés au mode développement.

Vérifier sur POS les affectations par entreprise, la réception par IMEI, les écarts, les ventes et crédits, la caisse, les inventaires, le SAV, les rapports et les permissions d’administration. Direction et Administrateur utilisent la double authentification POS.

## Hébergement

Compiler le frontend avec `VITE_SMTR_BASE_PATH=/sinocet/smtr/ npm run build`. Publier le contenu de `dist` dans `public_html/sinocet/smtr` après validation de POS. L’interface utilise `/ekolabs/pos/api/v1` et `/ekolabs/pos/ws` sur la même origine. Le proxy doit prendre en charge la mise à niveau WebSocket. Le service worker garde le shell dans le cache et les jetons restent en mémoire.

Le déploiement POS se fait dans `public_html/ekolabs/pos/api`. Appliquer les migrations sur la base POS cible et configurer l’entreprise Sinocet selon le guide SMTR du dépôt EkoLabs.
