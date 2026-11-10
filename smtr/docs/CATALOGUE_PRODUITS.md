# SMTR : catalogue, caractéristiques et import Excel

## Modèle produit générique

- products : SKU, nom, description, catégorie, suivi et seuil ; brand_id et model_id facultatifs.
- brands : marques propres à l'entreprise (name, description, active, auteur et dates).
- models : modèles propres à l'entreprise, rattachés à une marque via brand_id.
- characteristics : définitions de caractéristiques réutilisables (name et description).
- products_characteristics : une valeur textuelle par caractéristique et par produit, en clé étrangère et sous le contrôle de l'entreprise.
- suppliers : table existante du POS réutilisée. Les réceptions pointent vers items.supplier_id, jamais vers un nom libre.

Les caractéristiques ne sont pas limitées à l'électronique : matière, couleur, dimensions, RAM, taille, conditionnement, etc., sont des définitions de l'entreprise, pas des colonnes obligatoires de products.

## Écrans

Produits -> Marques, modèles et caractéristiques : référentiels réutilisables ; création Manager ou Direction.
Produits -> Nouveau produit : sélection des références existantes, puis caractéristiques dynamiques.
Stocks -> Réceptionner : sélection du fournisseur existant (code et nom), puis IMEI ou quantité selon le mode de suivi.

Le coût d'achat et les prix ne sont modifiables que par la Direction. L'Agent peut consulter les produits actifs, sans voir les coûts.

## Import Excel généré via API

Feuilles :
1. PRODUITS : action CREER/MODIFIER, SKU, nom, catégorie, marque, modèle et données commerciales ;
2. CARACTERISTIQUES : SKU, CARACTERISTIQUE, VALEUR ; une ligne par caractéristique ;
3. STOCK : SKU, IMEI, QUANTITE, EMPLACEMENT, CODE_FOURNISSEUR, REFERENCE_RECEPTION, DATE_RECEPTION ;
4. INSTRUCTIONS : règles et limites.

Les marques, modèles et définitions de caractéristiques doivent être créés avant import. Le code fournisseur doit correspondre à un enregistrement actif de suppliers propre à l'entreprise, sans création implicite.

Les prévisualisations signalent les erreurs, les doublons, les références manquantes. Tout import est transactionnel et revérifié lors de la confirmation. Le modèle statique historique reste présent mais les boutons téléchargent le classeur généré par POS.

## Déploiement

1. Sauvegarder une base de recette POS, exécuter migrations 20261110000200 et 20261110000300 et vérifier les FK.
2. Vérifier l'éventuelle reprise des anciennes colonnes libres (elles ne sont pas supprimées sans vérification).
3. Exécuter tests unitaires, intégration, et parcours Playwright des quatre rôles.
4. Déployer d'abord POS puis SMTR, uniquement après validation.

Aucune fusion ni mise en production n'est effectuée par ces changements.
