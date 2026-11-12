# SMTR : attributs globaux, caractéristiques des produits et import Excel

## Modèle produit générique

- `products` : SKU, nom, description, catégorie, suivi, seuil et `organization_id` ; références facultatives `brand_id` et `model_id`.
- `brands` : marques globales (`name` unique), sans `organization_id`.
- `models` : modèles globaux, `brand_id` vers `brands.id`, `UNIQUE(brand_id, name)`.
- `attributes` : définitions communes à toutes les entreprises (`id`, `name` unique, `description`, `active`, audit), sans `organization_id`. Exemples : Couleur, Matière, Stockage.
- `characteristics` : valeurs de chaque produit (`id`, `product_id`, `attribute_id`, `value`, `active`, audit), sans `organization_id`. Clés étrangères vers `products.id` et `attributes.id` ; unicité `(product_id, attribute_id)`.
- `suppliers` : table POS existante, propre à l'entreprise. Les réceptions pointent vers `items.supplier_id`, jamais vers un nom libre.

Une définition (« Couleur ») est dans `attributes`. La valeur (« Noir ») est dans `characteristics` pour un produit précis. Rien n'impose des colonnes propres aux téléphones dans `products`.

## Écrans

Dans **Produits → Référentiels**, les marques, modèles et **attributs** globaux sont consultables. La Direction peut ajouter une définition ; les modifications et suppressions d'un référentiel partagé ne sont pas proposées.

Dans **Produits → Nouveau produit**, choisir la marque/le modèle existant puis renseigner les valeurs des attributs disponibles. Le formulaire envoie `characteristics: [{attributeId, value}]` ; à la lecture, chaque valeur fournit `attributeId`, `name` et `value`.

Dans **Stocks → Réceptionner**, choisir un fournisseur existant, puis des IMEI ou des quantités selon le mode de suivi.

Seule la Direction peut renseigner les prix et coûts. L'Agent voit les produits actifs sans accéder aux coûts.

## Import Excel

Le modèle téléchargé depuis l'API comprend quatre feuilles :

1. `PRODUITS` : `ACTION`, SKU, nom, catégorie, marque, modèle et données commerciales ;
2. `CARACTERISTIQUES` : `SKU`, `CARACTERISTIQUE`, `VALEUR`. `CARACTERISTIQUE` contient le nom de l'**attribut global** ;
3. `STOCK` : SKU, IMEI, quantité, emplacement, code fournisseur, référence et date de réception ;
4. `INSTRUCTIONS` : règles d'import et exemples.

Les marques, modèles et attributs doivent exister avant import. Le code fournisseur doit pointer vers un fournisseur POS actif appartenant à l'entreprise. Les prévisualisations rejettent les références invalides et les doublons ; l'import est transactionnel et revérifié lors de la confirmation.

## Déploiement : sauvegarde et QA indispensables

1. Sauvegarder une base POS de recette et vérifier l'état des migrations.
2. Pour une base neuve, exécuter 00200, 00300 et 00400 (00400 ne change rien sur le nouveau schéma).
3. Pour une base ayant déjà l'ancien schéma 00300, tester la conversion 00400 sur copie : `characteristics` → `attributes`, `products_characteristics` → `characteristics`, `characteristic_id` → `attribute_id`. Si `organization_id` ou `value_text` existent encore, une conversion de données préalable spécifique est nécessaire.
4. Vérifier clés étrangères, unicité, isolation multi-entreprise, import Excel, tests API d'intégration et Playwright pour les quatre profils.
5. Déployer POS et ses migrations avant le frontend SMTR, uniquement après validation.

Les PR ne sont pas fusionnées et aucune mise en production n'est effectuée par ces changements.
