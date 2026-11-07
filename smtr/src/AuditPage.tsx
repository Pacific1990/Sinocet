import { useState } from 'react';
import { DataTable, Empty, Field, Filters, Loading, Notice, Panel, useRemote } from './CatalogueUI';
import { type AuditEvent } from './services';
const ACTIONS:Record<string,string>={
  SALE_COMPLETED:'Vente enregistrée',SALE_CANCELLED:'Vente annulée',
  DEBT_REPAID:'Remboursement enregistré',CASH_CLOSED:'Caisse clôturée',
  TRANSFER_SENT:'Transfert envoyé',TRANSFER_RECEIVED:'Réception validée',
  TRANSFER_DISCREPANCY:'Écart de réception',TRANSFER_RESOLVED:'Écart résolu',
  INVENTORY_STARTED:'Inventaire démarré',INVENTORY_CLOSED:'Inventaire clôturé',
  INVENTORY_RECONCILED:'Inventaire rapproché',STOCK_FROZEN:'Stock gelé',STOCK_UNFROZEN:'Stock débloqué',
  SAV_OPENED:'Retour SAV enregistré',SAV_STARTED:'Traitement SAV démarré',
  SAV_RESOLVED:'SAV résolu',SAV_RELEASED:'Remise en stock après SAV',
  APPROVAL_REQUESTED:'Validation demandée',APPROVAL_DECIDED:'Décision de validation',
  CUSTOMER_CREATED:'Client créé',CUSTOMER_CREDIT_LIMIT:'Plafond client modifié',
};
const OBJECTS:Record<string,string>={sales:'Vente',transfers:'Transfert',inventories:'Inventaire',
  items:'Appareil',warehouses:'Entrepôt',sav_cases:'Dossier SAV',approvals:'Validation',
  customers:'Client',cash_closures:'Clôture de caisse',payments:'Paiement',products:'Produit'};
type Props={token:string|null;preview:boolean;refresh:number;onLogout:()=>void};
export default function AuditPage(props:Props){
  const request=useRemote<{events:AuditEvent[]}>(props.token,'/audit/events',props.refresh,props.onLogout);
  const [search,setSearch]=useState('');
  const rows=(request.data?.events||[]).filter(e=>
    (e.action+' '+(ACTIONS[e.action]||'')+' '+e.actor+' '+e.entity+' '+e.entityId).toLowerCase().includes(search.toLowerCase()));
  const showDetails=rows.some(row=>row.details!=null);
  if(props.preview)return <Panel title="Journal d’audit"><Empty>Connectez-vous pour accéder aux traces autorisées.</Empty></Panel>;
  return <div className="smtr-ref"><Panel title="Journal d’audit" subtitle="Événements immuables, horodatés et associés à un utilisateur">
    {request.error&&<Notice tone="error">{request.error}</Notice>}
    <Filters><Field label="Rechercher une opération"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Acteur, action, objet…"/></Field></Filters>
    {request.loading?<Loading/>:<DataTable
      headers={['DATE ET HEURE','ACTEUR','OPÉRATION','OBJET','ORIGINE',...(showDetails?['DÉTAILS']:[])]}
      rows={rows.map(row=>[
        new Date(row.occurredAt).toLocaleString('fr-FR'),row.actor,ACTIONS[row.action]||row.action,
        (OBJECTS[row.entity]||row.entity)+(row.entityId?' #'+row.entityId:''),row.sourceIp||'—',
        ...(showDetails?[row.details==null?'—':<details><summary>Avant / après</summary><pre style={{whiteSpace:'pre-wrap',maxWidth:320}}>{JSON.stringify(row.details,null,2)}</pre></details>]:[]),
      ])}/>}
    <p className="catalog-note">Le journal est alimenté par le serveur. Les entrées enregistrées ne peuvent être ni modifiées ni supprimées via l’application.</p>
  </Panel></div>;
}
