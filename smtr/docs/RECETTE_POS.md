# Recette de la réception Agent via EkoLabs POS

Le build de recette réutilise l'écran de réception Agent. Il utilise le compte et l'entreprise POS pour charger les transferts attribués, confirmer les appareils ou signaler un écart.

```sh
VITE_SMTR_BASE_PATH=/sinocet/smtr/ \
VITE_SMTR_POS_RECEPTION=true \
VITE_SMTR_POS_ORGANIZATION_ID=<id_pos_de_recette> \
npm run build
```

Héberger le build sur l'origine qui expose `/ekolabs/pos/api/v1` avec les routes de la PR EkoLabs #101. Utiliser une entreprise POS de recette activée, un membre `smtr_agent` et un transfert en transit attribué à son compte. Le jeton reste en mémoire et une session expirée renvoie à la connexion.

Vérifier la réception complète, le refus d'un compte d'une autre entreprise et le signalement d'un appareil manquant. Le mode de recette affiche seulement la réception Agent. Les autres parcours et l'administration nécessitent encore leur raccordement à POS avant le retrait de l'API autonome.
