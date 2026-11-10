# SMTR : catalogue, caractéristiques et import Excel

## Modèle produit générique

- products : SKU, nom, description, catégorie, suivi et seuil ; brand_id et model_id facultatifs.
- brands : référentiel global sans organization_id (name UNIQUE, description, active, auteur et dates).
- models : référentiel global sans organization_id ; rattachement à brands.id via brand_id et unicité sur (brand_id, name).
- characteristics : référentiel global (name UNIQUE, description, active, audit), sans organization_id. Les définitions sont partagées entre toutes les entreprises.
- products_characteristics : association (product_id, characteristic_id, value), sans organization_id. Unicité sur (product_id, characteristic_id) ; l'entreprise est obtenue via products.organization_id et la définition est globale.
- suppliers : table existante du POS réutilisée. Les réceptions pointent vers items.supplier_id, jamais vers un nom libre.

Les caractéristiques ne sont pas limitées à l'électronique : matière, couleur, dimensions, RAM, taille, conditionnement, etc., sont des définitions globales partagées et non des colonnes obligatoires de products.

## Écrans

Produits -> Marques, modèles et caractéristiques : trois référentiels globaux partagés, consultables et sélectionnables pour les produits ; ajout de définitions réservé à la Direction. Aucune édition ni suppression d'une référence partagée n'est proposée.
Produits -> Nouveau produit : sélection des références existantes, puis caractéristiques dynamiques.
Stocks -> Réceptionner : sélection du fournisseur existant (code et nom), puis IMEI ou quantité selon le mode de suivi.

Le coût d'achat et les prix ne sont modifiables que par la Direction. L'Agent peut consulter les produits actifs, sans voir les coûts.

## Import Excel généré via API

Feuilles :
1. PRODUITS : action CREER/MODIFIER, SKU, nom, catégorie, marque, modèle et données commerciales ;
2. CARACTERISTIQUES : SKU, CARACTERISTIQUE, VALEUR ; une ligne par caractéristique ;
3. STOCK : SKU, IMEI, QUANTITE, EMPLACEMENT, CODE_FOURNISSEUR, REFERENCE_RECEPTION, DATE_RECEPTION ;
4. INSTRUCTIONS : règles et limites.

Les marques, modèles et caractéristiques sont tous des référentiels globaux partagés, enrichissables par la Direction. Un modèle appartient à une marque, pas à une entreprise. Le code fournisseur doit correspondre à un enregistrement actif de suppliers propre à l'entreprise, sans création implicite.

Les prévisualisations signalent les erreurs, les doublons, les références manquantes. Tout import est transactionnel et revérifié lors de la confirmation. Le modèle statique historique reste présent mais les boutons téléchargent le classeur généré par POS.

## Déploiement

1. Sauvegarder une base de recette POS, exécuter migrations 20261110000200 et 20261110000300 et vérifier les FK.
2. Vérifier l'éventuelle reprise des anciennes colonnes libres ; si brands, models, characteristics ou products_characteristics existent déjà avec organization_id ou value_text, prévoir une migration de conversion sécurisée et non destructive.
3. Exécuter tests unitaires, intégration, et parcours Playwright des quatre rôles.
4. Déployer d'abord POS puis SMTR, uniquement après validation.

Aucune fusion ni mise en production n'est effectuée par ces changements.
