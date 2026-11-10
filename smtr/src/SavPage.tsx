import { useState, type FormEvent } from 'react';
import { ShieldAlert } from 'lucide-react';
import { DataTable, Empty, Field, Loading, Metric, Notice, Panel, SmallButton, Status, SubmitButton, useRemote } from './CatalogueUI';
import { displayError, fcfa, get, post, shortDate, validUuid, type SavCase, type Sale, type Approval } from './services';
import type { Role } from './permissions';
import type { ModuleId } from './permissions';

type Props={role:Role;token:string|null;preview:boolean;refresh:number;onLogout:()=>void;onRefresh:()=>void;onNavigate:(m:ModuleId)=>void};
type WarehouseItem={id:string;caseId:string;saleId:string;imeiMasked:string;product:string;defect:string;status:string;resolution:string|null;enteredAt:string};
type CentralWarehouse={id:string;name:string};
type CentralItem={id:string;productName:string;imeiMasked:string;location:string};

export default function SavPage(props:Props){
  const agent=props.role==='agent';
  const cases=useRemote<{cases:SavCase[]}>(props.token,'/cases',props.refresh,props.onLogout);
  const sales=useRemote<{items:Sale[]}>(agent?props.token:null,'/sales',props.refresh,props.onLogout);
  const warehouse=useRemote<{items:WarehouseItem[]}>(agent?null:props.token,'/cases/warehouse',props.refresh,props.onLogout);
  const approvals=useRemote<{approvals:Approval[]}>(agent?null:props.token,'/approvals',props.refresh,props.onLogout);
  const central=useRemote<{warehouses:CentralWarehouse[]}>(agent?null:props.token,'/stocks/central-warehouses',props.refresh,props.onLogout);
  const [saleId,setSaleId]=useState('');
  const [defect,setDefect]=useState('');
  const [selected,setSelected]=useState('');
  const [creating,setCreating]=useState(false);
  const [approvalId,setApprovalId]=useState('');
  const [replacementId,setReplacementId]=useState('');
  const [centralId,setCentralId]=useState('');
  const [refundMethod,setRefundMethod]=useState('CASH');
  const [refundReference,setRefundReference]=useState('');
  const [refundConfirmed,setRefundConfirmed]=useState(false);
  const [repairVerified,setRepairVerified]=useState(false);
  const [requestId,setRequestId]=useState(validUuid);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [tab,setTab]=useState<'active'|'resolved'|'warehouse'>('active');
  const list=cases.data?.cases||[];
  const filtered=list.filter(x=>tab==='active'?['OPEN','IN_PROGRESS'].includes(x.status):
    tab==='resolved'?['RESOLVED','RELEASED'].includes(x.status):true);
  const active=list.filter(x=>['OPEN','IN_PROGRESS'].includes(x.status));
  const current=list.find(x=>x.id===selected);
  const allowedApprovals=(approvals.data?.approvals||[]).filter(x=>
    x.kind==='SAV_RESOLUTION'&&x.status==='APPROVED'&&x.caseId===selected);
  const [centralItems,setCentralItems]=useState<CentralItem[]>([]);
  async function refreshReplacement(warehouseId:string){
    setCentralId(warehouseId);setCentralItems([]);setReplacementId('');
    if(!props.token||!warehouseId)return;
    try{
      const data=await get<{items:CentralItem[]}>('/stocks/items?warehouseId='+warehouseId,props.token);
      setCentralItems(data.items);
    }catch(e){setError(displayError(e,props.onLogout));}
  }
  async function open(event:FormEvent){
    event.preventDefault();if(!props.token||busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      const result=await post<{case:{id:string}}>('/cases',props.token,{
        saleId,defect,factoryDefectConfirmed:true,
      });
      setMessage('Dossier SAV Ramba #'+result.case.id+' ouvert. L’IMEI est sorti du stock vendable.');
      setSaleId('');setDefect('');setCreating(false);cases.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  async function start(id:string){
    if(!props.token||busy)return;
    setBusy(true);setMessage('');setError('');
    try{
      await post('/cases/'+id+'/start',props.token,{});
      setMessage('Prise en charge du dossier #'+id+'.');
      cases.reload();warehouse.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  async function resolve(event:FormEvent){
    event.preventDefault();if(!props.token||busy||!current)return;
    if(!approvalId){setError('Une validation préalable du Manager est obligatoire.');return;}
    setBusy(true);setMessage('');setError('');
    try{
      const approval=allowedApprovals.find(x=>x.id===approvalId);
      if(!approval)throw new Error('Validation absente ou non approuvée.');
      const outcome=await post<{case:{id:string;resolution:string;refundF:number}}>('/cases/'+selected+'/resolve',props.token,{
        approvalId,
        ...(approval.resolution==='EXCHANGE'?{replacementItemId:replacementId}:{}),
        ...(approval.resolution==='REFUND'?{
          refundMethod,refundConfirmed,refundReference,requestId,
        }:{}),
      });
      setMessage('Dossier #'+outcome.case.id+' résolu : '+outcome.case.resolution+
        (outcome.case.refundF?' · '+fcfa(outcome.case.refundF)+' remboursés':''));
      setSelected('');setApprovalId('');setRefundReference('');setReplacementId('');
      setRequestId(validUuid());cases.reload();warehouse.reload();approvals.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  async function release(id:string){
    if(!props.token||busy||!repairVerified||!centralId)return;
    setBusy(true);setError('');setMessage('');
    try{
      await post('/cases/'+id+'/release',props.token,{
        centralWarehouseId:centralId,repairVerified:true,
      });
      setMessage('Contrôle physique et sortie SAV du dossier #'+id+' enregistrés.');
      setSelected('');setRepairVerified(false);cases.reload();warehouse.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }

  if(props.preview)return <Panel title="SAV & retours — Ramba">
    <Empty>Authentifiez-vous pour consulter les dossiers de défaut d’usine.</Empty>
  </Panel>;
  return <div className={'smtr-ref '+(agent?'catalog-phone-panel':'')}>
    {message&&<Notice tone="success">{message}</Notice>}
    {(error||cases.error||warehouse.error||approvals.error||sales.error)&&
      <Notice tone="error">{error||cases.error||warehouse.error||approvals.error||sales.error}</Notice>}
    {!creating&&!current&&<>
    <div className="catalog-metrics">
      <Metric label="DOSSIERS EN COURS" value={active.length}/>
      <Metric label="RÉSOLUS" value={list.filter(x=>x.status==='RESOLVED').length}/>
      <Metric label="RÉINTÉGRÉS" value={list.filter(x=>x.status==='RELEASED').length}/>
    </div>
    <div className="catalog-warning-box">
      <ShieldAlert size={17}/> <strong>Ramba — entrepôt virtuel SAV</strong>.
      Les appareils retournés pour défaut d’usine sont isolés, non vendables et ne constituent jamais une catégorie de marchandises fournisseur.
    </div>
    </>}
        {agent&&creating&&<Panel action={<SmallButton onClick={()=>setCreating(false)}>Retour à la liste</SmallButton>} title="Déclarer un retour SAV" subtitle="Après vérification du défaut d’usine et du numéro de vente">
      <form className="catalog-form" onSubmit={open}>
        <Field label="Vente d’origine">
          <select value={saleId} required onChange={e=>setSaleId(e.target.value)}>
            <option value="">Sélectionner une vente</option>
            {sales.data?.items.filter(x=>x.status==='COMPLETED').map(s=>
              <option key={s.id} value={s.id}>#{s.id} · {s.title} · {s.subtitle}</option>)}
          </select>
        </Field>
        <Field label="Description du défaut constaté">
          <textarea rows={3} value={defect} minLength={10} maxLength={600} required
            onChange={e=>setDefect(e.target.value)} placeholder="Décrivez le défaut d’usine constaté"/>
        </Field>
        <p className="catalog-note">L’appareil concerné doit être physiquement reçu. Après création, il bascule dans l’entrepôt SAV non vendable.</p>
        <SubmitButton disabled={busy}>{busy?'Enregistrement…':'Ouvrir le dossier SAV'}</SubmitButton>
      </form>
    </Panel>}
    {!creating&&!current&&<>
    <Panel title={agent?'Mes dossiers SAV':'Suivi des dossiers SAV'} subtitle="Réception, prise en charge et résolution"
      action={agent&&<SmallButton kind="blue" onClick={()=>setCreating(true)}>+ Déclarer un retour SAV</SmallButton>}>
      <div className="catalog-tab-group">
        <button className={'catalog-tab '+(tab==='active'?'active':'')} type="button" onClick={()=>setTab('active')}>En cours</button>
        <button className={'catalog-tab '+(tab==='resolved'?'active':'')} type="button" onClick={()=>setTab('resolved')}>Résolus</button>
        {!agent&&<button className={'catalog-tab '+(tab==='warehouse'?'active':'')} type="button" onClick={()=>setTab('warehouse')}>Stock Ramba</button>}
      </div>
      {cases.loading?<Loading/>:tab==='warehouse'&&!agent?
        <DataTable headers={['IMEI','PRODUIT','DÉFAUT','STATUT','DOSSIER']}
          rows={(warehouse.data?.items||[]).map(x=>[
            x.imeiMasked,x.product,x.defect,<Status label={x.status}/>,
            <SmallButton onClick={()=>setSelected(x.caseId)}>Dossier #{x.caseId}</SmallButton>,
          ])}/>:
        <DataTable headers={['DOSSIER','CLIENT','PRODUIT','DÉFAUT','STATUT','ACTION']}
          rows={filtered.map(c=>[
            '#'+c.id,c.customer,
            <span>{c.product}<br/><small>IMEI {c.imeiMasked}</small></span>,
            c.defect,<Status label={c.status}/>,
            agent?<span>{shortDate(c.createdAt)}</span>:
              <div className="catalog-actions">
                {c.status==='OPEN'&&<SmallButton disabled={busy} onClick={()=>start(c.id)}>Prendre en charge</SmallButton>}
                <SmallButton onClick={()=>{setSelected(c.id);setApprovalId('');}}>Détails</SmallButton>
              </div>,
          ])}/>}
    </Panel>
    </>}
        {!agent&&current&&<Panel title={'Dossier SAV #'+current.id}
      subtitle={current.product+' · IMEI '+current.imeiMasked}>
      <div className="catalog-row"><span>Défaut déclaré</span><strong>{current.defect}</strong></div>
      <div className="catalog-row"><span>État</span><Status label={current.status}/></div>
      <div className="catalog-row"><span>Décision</span><strong>{current.resolution||'En attente'}</strong></div>
      {['OPEN','IN_PROGRESS'].includes(current.status)&&
        <form className="catalog-form" onSubmit={resolve}>
          <Field label="Validation de résolution SAV approuvée">
            <select required value={approvalId} onChange={e=>setApprovalId(e.target.value)}>
              <option value="">Sélectionner la validation</option>
              {allowedApprovals.map(a=><option key={a.id} value={a.id}>#{a.id} · {a.resolution} · {a.requestedBy}</option>)}
            </select>
          </Field>
          {!allowedApprovals.length&&<Notice tone="warning">L’agent doit demander une validation SAV dans le module Validations avant toute résolution.</Notice>}
          {allowedApprovals.find(a=>a.id===approvalId)?.resolution==='EXCHANGE'&&<>
            <Field label="Entrepôt central du remplacement">
              <select value={centralId} required onChange={e=>{void refreshReplacement(e.target.value);}}>
                <option value="">Sélectionner le dépôt</option>
                {central.data?.warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <Field label="IMEI de remplacement vérifié">
              <select required value={replacementId} onChange={e=>setReplacementId(e.target.value)}>
                <option value="">Choisir un article disponible</option>
                {centralItems.map(i=><option key={i.id} value={i.id}>{i.productName} · {i.imeiMasked}</option>)}
              </select>
            </Field>
          </>}
          {allowedApprovals.find(a=>a.id===approvalId)?.resolution==='REFUND'&&<>
            <Field label="Mode de remboursement réellement effectué">
              <select value={refundMethod} onChange={e=>setRefundMethod(e.target.value)}>
                <option value="CASH">Espèces</option><option value="MOBILE_MONEY">Mobile Money</option><option value="TRANSFER">Virement</option>
              </select>
            </Field>
            <Field label="Référence du remboursement">
              <input required minLength={3} maxLength={120} value={refundReference} onChange={e=>setRefundReference(e.target.value)}/>
            </Field>
            <label><input type="checkbox" checked={refundConfirmed} onChange={e=>setRefundConfirmed(e.target.checked)}/> Confirmer que le remboursement a réellement été effectué</label>
          </>}
          <div className="catalog-actions">
            <SmallButton onClick={()=>props.onNavigate('approvals')}>Voir les validations</SmallButton>
            <SubmitButton disabled={busy||!approvalId}>Confirmer la résolution</SubmitButton>
          </div>
        </form>}
      {current.status==='RESOLVED'&&current.resolution==='REPAIR'&&<>
        <Field label="Entrepôt central de retour contrôlé">
          <select value={centralId} onChange={e=>setCentralId(e.target.value)}>
            <option value="">Sélectionner le dépôt</option>
            {central.data?.warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <label className="catalog-note"><input type="checkbox" checked={repairVerified} onChange={e=>setRepairVerified(e.target.checked)}/> Réparation et vérification physique effectuées</label>
        <SmallButton kind="blue" disabled={busy||!centralId||!repairVerified} onClick={()=>release(current.id)}>
          Valider la sortie SAV</SmallButton>
      </>}
      <div style={{marginTop:12}}><SmallButton onClick={()=>setSelected('')}>Fermer le dossier</SmallButton></div>
    </Panel>}
  </div>;
}
