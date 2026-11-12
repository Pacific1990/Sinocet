# Pilotage de la recette SMTR

## Ce qui existe et ce qui a été ajouté

**Déjà présent dans SMTR** : authentification POS et MFA, tableaux de bord Administrateur/Direction/Manager/Agent, catalogue des produits et attributs globaux, import Excel et modèle téléchargeable, stock central et IMEI, transferts avec validation de réception, SAV, caisse, audits et restrictions hiérarchiques ; écran de formulaire séparé de la liste et interface pleine largeur.

**Ajouté pour la recette** : module « Validation QA » commun aux quatre profils avec persistance POS, modèles de scénarios réutilisables, plan de tests par compte, saisie du résultat réel, filtres rôle/module/environnement, tableau à mise à jour rapide, kanban, blocages et vue « Prêts à valider ». Rien ne passe en « Validé » lors de l'instanciation d'un modèle.

## Utilisation

1. Se connecter au **bon environnement** avec un compte de recette (ne pas communiquer les secrets dans les fiches).
2. Ouvrir **Validation QA → Modèles de parcours**. Les scénarios décrivent des fonctionnalités existantes, ils ne lancent aucune opération automatiquement.
3. Créer une fiche depuis le modèle de son rôle. Elle commence à l'état **À tester**.
4. Dans la page de détail, renseigner le **compte de test** (identifiant sans mot de passe), les données de test, l'attendu, le résultat réellement constaté, l'environnement, un lien de capture/rapport, le bug et la prochaine action si nécessaire, la branche/PR et le SHA du commit réel.
5. Passer le statut à **En cours**, **Bloqué**, **Échec**, ou **Prêt à valider** depuis la fiche ou les sélecteurs rapides du tableau/kanban. Une fiche prête nécessite un résultat obtenu, une preuve et un environnement.
6. La **Direction** ou l'**Administrateur** examine la preuve et passe explicitement une fiche de **Prêt à valider** à **Validé**. Le serveur refuse une validation directe depuis un état non prêt.
7. La vue **Playwright / comptes** regroupe les fiches automatisées par identifiant de compte ; elle ne prétend pas exécuter Playwright, ni générer une preuve sans un test réellement effectué.
8. Utiliser **Blocages** pour traiter les échecs, et **À valider** pour les dossiers complétés.

## Sécurité et hiérarchie

- Toutes les fiches sont limitées à `organization_id` et protégées par authentification et autorisations du serveur POS.
- Administrateur : tous les rôles. Direction : Direction, Manager et Agent, jamais Administrateur. Manager : Manager et Agent, jamais les rôles supérieurs. Agent : fiches Agent qu'il a lui-même créées.
- Chaque changement de statut, de preuve ou de résultat génère un événement d'audit sans copier les secrets ni le texte du rapport dans les métadonnées de cet événement.
- Les règles existantes du journal d'audit SMTR empêchent qu'un rôle inférieur consulte les actions d'un rôle supérieur. Le registre QA est un suivi de tests, pas une nouvelle API permettant de lire les journaux de ces comptes.
- Les **mots de passe, OTP, tokens et identifiants sensibles ne doivent jamais être saisis** dans « Compte de test », « Données de test » ni les pièces justificatives. Un lien vers une capture (stockée dans un emplacement autorisé) peut être renseigné ; le site ne téléverse pas de captures lui-même.
- La création d'un modèle ou d'une fiche ne vaut ni succès de test ni approbation. Un commit ou une PR saisis n'attestent pas d'une exécution.

## Données et API

Migration POS `20261111000100_smtr_qa_validation.js` :
`smtr_qa_cases` avec rôle, module, modèle, scénario, données, attendu, obtenu, statut, bug, preuve URL, branche/PR, commit, environnement dev/prod, prochaine action, identifiant de compte, mode manuel/Playwright et auteurs/date d'audit système.

Endpoints sous `/api/v1/workspaces/smtr` :

- `GET /qa/templates` : modèles connus autorisés pour le rôle ;
- `GET /qa/cases` : fiches de recette visibles selon la hiérarchie ;
- `POST /qa/cases` : instanciation d'un modèle connu, statut initial `todo` ;
- `PATCH /qa/cases/:id` : résultats, preuves et transitions de statut contrôlés par le serveur.

Les statuts sont `todo`, `running`, `blocked`, `failed`, `ready`, `validated`. Le serveur vérifie le périmètre de rôle à chaque opération. Il n'y a **aucune date fictive** de passage des tests.

Pour les environnements qui ont personnalisé les menus, l'Administrateur doit activer la nouvelle entrée `qa` dans les menus du rôle. La migration crée les droits `workflow.qa.view` et `workflow.qa.manage` pour les quatre profils, y compris les entreprises déjà configurées ; le serveur limite ensuite les opérations en fonction du rôle.

## Recette à exécuter avant fusion et déploiement

- Sauvegarder la base POS de **recette**, exécuter la migration et vérifier la table, les FK et les autorisations.
- Tester les quatre comptes réels de recette, sans stocker leurs mots de passe. Pour chaque rôle, vérifier la navigation et l'accès direct à une URL interdite.
- Playwright (par compte) : vérifier connexion/MFA, disponibilité des parcours, présence des champs, accès refusés et création/édition de fiches. **Les rapports et captures doivent être joints après exécution**, pas simulés.
- Vérifier stock IMEI, refus de doublon, transfert Central → Agent en transit puis validation, écarts, modèle Excel, import prévisualisé, catalogue produits, audit hiérarchique.
- Vérifier que les fiches `blocked` et `failed` ne sont pas classées `ready`, que les fiches sans preuve ne passent pas `ready` et que les Managers/Agents ne peuvent pas forcer `validated`.
- Vérifier que les fiches d'une autre organisation sont inaccessibles et que l'Agent ne voit pas les fiches de ses collègues.
- Confirmer la largeur des pages et la séparation des formulaires sur écran étroit et bureau.
- Garder les PR non fusionnées tant que la recette MySQL et les parcours Playwright n'ont pas été vérifiés.

## Branches de travail

- POS : https://github.com/Pacific1990/EkoLabs/pull/109
- SMTR : https://github.com/Pacific1990/Sinocet/pull/11

Ces PR sont des travaux de code : leur existence ne vaut pas validation en environnement DEV ou PROD.
