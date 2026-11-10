# Catalogue produits et import Excel SMTR

Le menu Produits gère les fiches commerciales (une référence SKU par variante). Le menu Stocks reçoit les unités physiques. Les formulaires sont séparés des listes.

Une fiche contient nom, catégorie, SKU, marque, modèle, variante, couleur, stockage, RAM, garantie, description, seuil et suivi individual (IMEI) ou standard (quantité). La Direction seule peut écrire prix et coût. Aucun coût d'achat n'est renvoyé dans le catalogue.

## Modèle Excel

Le bouton Télécharger le modèle Excel télécharge un classeur de trois feuilles :

- PRODUITS : ACTION (CREER ou MODIFIER), SKU, NOM, CATEGORIE et caractéristiques ; aucune mise à jour implicite.
- STOCK : SKU, IMEI, QUANTITE, EMPLACEMENT, FOURNISSEUR, REFERENCE_RECEPTION et DATE_RECEPTION.
- INSTRUCTIONS : validation, limites et droits.

individual : 1 IMEI de 15 ou 16 chiffres au format texte par ligne. standard : IMEI vide et quantité positive. Prévisualisation obligatoire avant confirmation. Le serveur recontrôle tout au moment de l'import, en transaction.

Limites : fichier XLSX jusqu'à 2 Mo, 500 lignes et 500 unités par import de stock. L'ancien fichier statique du dépôt reste pour compatibilité ; les boutons utilisent la génération dynamique API.

## Accès

Agent : consultation des produits actifs, sans quantités globales ni coûts.
Manager : fiches et réceptions, sans coût d'achat.
Direction : fiches, prix et coûts.
Administrateur : permissions/menus, sans accès direct aux données métier.

## Déploiement

1. Sauvegarder une base POS de recette, puis installer les migrations POS (incluant 20261110000200_smtr_catalogue_details).
2. Tester API, permissions, transferts et Excel.
3. Déployer le frontend SMTR seulement lorsque l'API est prête.
4. Réaliser les quatre parcours QA sur l'environnement cible.

Contrainte historique : SKU unique globalement dans POS, et non encore par entreprise. Les produits standard utilisent des unités internes identifiées individuellement. Aucun déploiement production n'est effectué par cette PR.
