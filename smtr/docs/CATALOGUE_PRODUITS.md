# SMTR : catalogue, caractéristiques et import Excel

## Modèle produit générique

- products : SKU, nom, description, catégorie, suivi et seuil ; brand_id et model_id facultatifs.
- brands : marques propres à l'entreprise (name, description, active, auteur et dates).
- models : modèles propres à l'entreprise, rattachés à une marque via brand_id.
- characteristics : référentiel global (name UNIQUE, description, active, audit), sans organization_id. Les définitions sont partagées entre toutes les entreprises.
- products_characteristics : association (product_id, characteristic_id, value), sans organization_id. Unicité sur (product_id, characteristic_id) ; l'entreprise est obtenue via products.organization_id et la définition est globale.
- suppliers : table existante du POS réutilisée. Les réceptions pointent vers items.supplier_id, jamais vers un nom libre.

Les caractéristiques ne sont pas limitées à l'électronique : matière, couleur, dimensions, RAM, taille, conditionnement, etc., sont des définitions globales partagées et non des colonnes obligatoires de products.

## Écrans

Produits -> Marques et modèles : référentiels de l'entreprise, création Manager ou Direction. Les caractéristiques sont des définitions globales, consultation pour tous, ajout réservé à la Direction (aucune édition ni suppression par l'entreprise).
Produits -> Nouveau produit : sélection des références existantes, puis caractéristiques dynamiques.
Stocks -> Réceptionner : sélection du fournisseur existant (code et nom), puis IMEI ou quantité selon le mode de suivi.

Le coût d'achat et les prix ne sont modifiables que par la Direction. L'Agent peut consulter les produits actifs, sans voir les coûts.

## Import Excel généré via API

Feuilles :
1. PRODUITS : action CREER/MODIFIER, SKU, nom, catégorie, marque, modèle et données commerciales ;
2. CARACTERISTIQUES : SKU, CARACTERISTIQUE, VALEUR ; une ligne par caractéristique ;
3. STOCK : SKU, IMEI, QUANTITE, EMPLACEMENT, CODE_FOURNISSEUR, REFERENCE_RECEPTION, DATE_RECEPTION ;
4. INSTRUCTIONS : règles et limites.

Les marques et modèles doivent exister pour l'entreprise, tandis que les caractéristiques proviennent du référentiel global partagé, enrichissable par la Direction. Le code fournisseur doit correspondre à un enregistrement actif de suppliers propre à l'entreprise, sans création implicite.

Les prévisualisations signalent les erreurs, les doublons, les références manquantes. Tout import est transactionnel et revérifié lors de la confirmation. Le modèle statique historique reste présent mais les boutons téléchargent le classeur généré par POS.

## Déploiement

1. Sauvegarder une base de recette POS, exécuter migrations 20261110000200 et 20261110000300 et vérifier les FK.
2. Vérifier l'éventuelle reprise des anciennes colonnes libres ; si les tables characteristics ou products_characteristics existent déjà avec organization_id ou value_text, prévoir une migration de conversion sécurisée et non destructive.
3. Exécuter tests unitaires, intégration, et parcours Playwright des quatre rôles.
4. Déployer d'abord POS puis SMTR, uniquement après validation.

Aucune fusion ni mise en production n'est effectuée par ces changements.
