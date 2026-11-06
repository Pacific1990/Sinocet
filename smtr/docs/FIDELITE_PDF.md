# SMTR — Correspondance écrans du catalogue PDF

**Source du design (autorité unique) :** `SMTR Sinocet Catalogue Maquettes.pdf` — catalogue v3.1 / CDC-SINOCET-2026-001. Ce document appartient au commanditaire ; il n'est pas dupliqué publiquement.

| Page PDF | Maquette / comportement | Implémentation |
|---|---|---|
| 4 | Agent mobile-first, grands points tactiles, réception, vente, crédits, caisse | Navigation mobile basse conservée. Les opérations non codées restent inactives |
| 8 | Utilisateurs & rôles, Direction / Manager / Agent, double authentification DG | Rôles SQL et contrôles API ; 2FA TOTP obligatoire pour Direction |
| 9 | Sécurité, traces d’opération horodatées | Journal des créations produits, entrées de stock, envois, réceptions, écarts ; encore à étendre aux autres modules |
| 11 | **Stock Central**, catégorie, quantité, seuil, emplacement, statut, « Réceptionner un lot », note « Ramba » | `StockCentral` : tableau avec catégories réelles, entrée du lot IMEI par IMEI ; Ramba bloqué comme catégorie fournisseur |
| 12 | **Nouveau transfert — Central → Agent** : destinataire, scan/recherche IMEI, choix, résumé, « Envoyer le transfert », passage à « En Transit » | `ManagerTransfers` : choix réel des articles et de l'agent, transaction serveur et état IN_TRANSIT |
| 15 | Tableau de bord Agent : accès rapides et indicateurs personnels uniquement | Indicateurs réels de stock et transferts en attente, sans inventer les ventes/crédits encore non implémentés |
| 17 | **Valider une réception** : IMEI attendus, cases vérifiées, « Valider la réception » et « Signaler un écart », engagement financier | `AgentReception` : bloc des IMEI attendus, vérification obligatoire, validation atomique ou signalement avec gel du stock |
| 21 | Entrepôt virtuel « Ramba » : non vendable, pas catégorie d'achat | Champ `items.state` inclut `SAV` ; aucune vente d'article non disponible ; workflow SAV reste à développer |

## Couleurs et structure

Les écrans d'exploitation utilisent le bleu d'action, l'en-tête et la barre latérale bleu marine, le fond gris pâle, les cartes blanches, les séparations de tableau et les badges vert/orange/rouge illustrés dans les pages 11–12–17. Il s'agit de **retranscrire les maquettes, pas de proposer une autre identité visuelle**.

Le PDF **ne présente pas de maquette précise de l'écran d'authentification** : le formulaire de connexion de la fondation initiale est donc conservé et seulement étendu avec un champ OTP. Son adaptation visuelle définitive dépendra d'une maquette approuvée ; aucune nouvelle direction artistique n'a été inventée ici.

Les noms ou chiffres figurant dans les maquettes sont **illustratifs**, et ne sont **jamais utilisés pour créer des articles, mouvements, ventes, comptes ou entrepôts réels**.
