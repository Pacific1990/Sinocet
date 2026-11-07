# SMTR — Correspondance avec le catalogue PDF

Référence de conception : **SMTR Sinocet Catalogue Maquettes.pdf**, CDC-SINOCET-2026-001, v3.1. Les données de démonstration du document ne sont pas insérées dans l’application.

| Pages | Écrans | Implémentation |
|---|---|---|
| 6, 10, 15 | Tableaux de bord Direction, Manager, Agent | `DashboardPage.tsx` ; données consolidées ou personnelles, marges réservées à la Direction |
| 7 | Cartographie des stocks | `SupervisionPage.tsx` ; entrepôts, disponibilité, transit, gel, SAV et détail IMEI masqué |
| 8 | Utilisateurs & rôles | `AdminPage.tsx` ; quatrième rôle Administrateur ajouté à la demande utilisateur ; création des comptes et gestion des droits côté API |
| 9 | Sécurité & audit | `AuditPage.tsx`, `AdminPage.tsx` ; TOTP Direction/Administrateur, journal métier et journal technique, protection SQL contre modification/suppression |
| 11 | Stock Central | `Operations.tsx` ; catégories, seuils, emplacement, réception de lots et import Excel ; Ramba exclu des achats fournisseurs |
| 12 | Transferts Central → Agent | `Operations.tsx` ; réservation transactionnelle, sélection et état IN_TRANSIT |
| 13 | Inventaire tournant | `InventoryPage.tsx` ; gel ciblé, comptage, écarts et rapprochement physique avant dégel |
| 14 | Validations sensibles | `ApprovalsPage.tsx` ; demandes et décisions de remise, annulation ou résolution SAV avec code Manager |
| 16 | Point de vente | `SalesPage.tsx`, `ImeiScanner.tsx` ; recherche/scan, prix sans coût d’achat, comptant/crédit/partiel et reçu PDF |
| 17 | Validation de réception Agent | `Operations.tsx` ; vérification complète, engagement atomique ou écart avec HOLD |
| 18, 22 | Crédits personnels/consolidés | `DebtsPage.tsx` ; échéances, plafonds, remboursements, rappels SMS/WhatsApp et reçus |
| 19 | Caisse quotidienne | `CashPage.tsx` ; répartition par mode, attendu/déclaré, clôture horodatée et historique |
| 20, 21 | SAV et Ramba | `SavPage.tsx` ; défaut usine, entrepôt isolé, réparation/échange/remboursement approuvés et remise en stock vérifiée |
| 23 | Rapports & exports | `ReportsPage.tsx` ; PDF/Excel, période, filtre agent, ventes, dettes, écarts et SAV mensuel |

La structure marine, fond clair, cartes blanches, actions bleues et badges de statut reprend le catalogue. Le formulaire de connexion est conservé et complété par le TOTP : le PDF n’impose pas de maquette de connexion. Les écrans techniques de permissions/menus/paramètres prolongent ces composants pour le rôle Administrateur demandé.

Le mode hors ligne reste partiel : brouillons de ventes, aucune validation ou réservation locale. Les actions sensibles nécessitent l’API et les droits serveur. La caméra dépend du navigateur ; la recherche/saisie IMEI reste disponible.
