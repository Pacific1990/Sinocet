# Validation SMTR — 7 novembre 2026

## Résultat local

| Contrôle | Résultat |
|---|---|
| Syntaxe API | Réussite |
| MySQL isolé, migrations 001 à 009 puis seconde exécution | Réussite, migrations inchangées et rejouables |
| Tests API | 29 réussis, aucun ignoré |
| Tests frontend | 4 réussis |
| TypeScript et compilation Vite | Réussite |
| Vérification Git des espaces/patchs | Réussite |
| Playwright Chromium, Agent 390 × 844 | Vente avec remise approuvée à 135 000 FCFA, crédit, reçu PDF, brouillon hors ligne et soumission après reconnexion |
| Playwright Chromium, ordinateur 1440 × 844 | 13 modules Manager, 13 modules Direction, 6 modules Administrateur ; aucune erreur JavaScript ou erreur API affichée |
| IndexedDB | Enregistrement confirmé après commit, filtrage par propriétaire et suppression |
| PWA compilée | Shell accessible après rechargement hors ligne ; aucune réponse API ni aucun jeton dans le cache |

Les données de recette ont été générées exclusivement dans une base MySQL locale dédiée suffixée `_qa`, jamais dans une base d’exploitation. Les comptes et secrets de recette ne figurent pas dans Git. Les captures de contrôle ne sont pas publiées.

## Couverture métier

- TOTP, chiffrement des secrets, refus du rejeu OTP, expiration/révocation de session, blocage et limitation des connexions.
- Rôle Administrateur, cloisonnement technique/métier, modification de permissions, révocation des sessions et menus par rôle.
- Paramètres JSON textuels/numériques, propagation de la société et de la pagination, seuils d’alerte effectifs.
- Stock IMEI, lot atomique, doublons, import Excel, destinataire du transfert, réception complète, réservation concurrente et retour physique des écarts.
- Vente unique et idempotente, crédit et plafonds client/Agent, remboursement idempotent, PDF, clôture de caisse unique.
- Remise approuvée, annulation avec IMEI physiquement rendu, remboursement unique et restauration du stock.
- SAV isolé, remboursement, réparation et remise en stock vérifiée, revente, échange et retour du matériel de remplacement.
- Protection du propriétaire actuel d’un IMEI contre les anciennes factures, tout en conservant les IMEI historiques des reçus.
- Gel d’inventaire ciblé, écarts et rapprochement physique avant dégel.
- Rapports PDF et Excel réellement lisibles, filtre de période, refus d’accès Agent, journal non modifiable/supprimable.
- Ticket WebSocket à usage unique et événements limités à une invalidation sans données commerciales.

## Limites de cette recette

La caméra physique, les authentificateurs matériels, Safari/iOS et les opérateurs Mobile Money réels n’ont pas été testés. La saisie IMEI reste disponible si `BarcodeDetector` manque. Les encaissements Mobile Money sont des écritures confirmées manuellement et non des débits automatiques.

Le mode hors ligne est limité aux brouillons et au shell : aucune vente n’est finalisée ni aucun stock réservé hors ligne. Après rechargement, une connexion en ligne est nécessaire car les sessions ne sont pas persistées dans le navigateur.

Aucun déploiement de production n’a été exécuté. La CI doit confirmer la même livraison sous Node 22 et MySQL 8 avant fusion.
