import { useState, type FormEvent } from 'react';
import { DataTable, Empty, Field, Loading, Notice, Panel, SmallButton, Status, SubmitButton, useRemote } from './CatalogueUI';
import { displayError, post, shortDate, validUuid, type Approval, type Sale, type SavCase, type SaleItem } from './services';
import type { Role } from './permissions';

type Props={role:Role;token:string|null;preview:boolean;refresh:number;onLogout:()=>void;onRefresh:()=>void};
const KINDS:Record<string,string>={DISCOUNT:'Remise',CANCEL_SALE:'Annulation de vente',SAV_RESOLUTION:'Résolution SAV'};
const DECISIONS:Record<string,string>={PENDING:'En attente',APPROVED:'Approuvée',REJECTED:'Refusée',APPLIED:'Appliquée'};

export default function ApprovalsPage(props:Props){
  const agent=props.role==='agent';
  const approvals=useRemote<{approvals:Approval[]}>(props.token,agent?'/approvals/mine':'/approvals',props.refresh,props.onLogout);
  const sales=useRemote<{items:Sale[]}>(agent?props.token:null,'/sales',props.refresh,props.onLogout);
  const stock=useRemote<{items:SaleItem[]}>(agent?props.token:null,'/sales/stock',props.refresh,props.onLogout);
  const cases=useRemote<{cases:SavCase[]}>(agent?props.token:null,'/cases',props.refresh,props.onLogout);
  const [kind,setKind]=useState('DISCOUNT');
  const [itemId,setItemId]=useState('');
  const [saleId,setSaleId]=useState('');
  const [caseId,setCaseId]=useState('');
  const [discount,setDiscount]=useState('5');
  const [resolution,setResolution]=useState('REPAIR');
  const [reason,setReason]=useState('');
  const [reviewId,setReviewId]=useState('');
  const [formView,setFormView]=useState<'request'|'cancel'|null>(null);
  const [decision,setDecision]=useState('APPROVED');
  const [pin,setPin]=useState('');
  const [cancelId,setCancelId]=useState('');
  const [cancelSale,setCancelSale]=useState('');
  const [returnedImei,setReturnedImei]=useState('');
  const [refundMethod,setRefundMethod]=useState('CASH');
  const [requestId,setRequestId]=useState(validUuid);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const list=approvals.data?.approvals||[];

  async function requestApproval(event:FormEvent){
    event.preventDefault();if(!props.token||busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      const payload={kind,reason,
        ...(kind==='DISCOUNT'?{itemId,discountPercent:Number(discount)}:{}),
        ...(kind==='CANCEL_SALE'?{saleId}:{}),
        ...(kind==='SAV_RESOLUTION'?{caseId,resolution}:{}),
      };
      const result=await post<{approval:{id:string}}>('/approvals',props.token,payload);
      setMessage('Demande de validation #'+result.approval.id+' enregistrée.');
      setReason('');setSaleId('');setItemId('');setCaseId('');
      approvals.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }

  async function review(event:FormEvent){
    event.preventDefault();if(!props.token||busy||!reviewId)return;
    setBusy(true);setError('');setMessage('');
    try{
      await post('/approvals/'+reviewId+'/decision',props.token,{decision,approvalCode:pin});
      setMessage('Décision '+(decision==='APPROVED'?'approuvée':'refusée')+' pour la demande #'+reviewId+'.');
      setPin('');setReviewId('');approvals.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }

  async function applyCancellation(event:FormEvent){
    event.preventDefault();if(!props.token||busy||!cancelSale)return;
    setBusy(true);setError('');setMessage('');
    try{
      const approved=list.find(a=>a.id===cancelId);
      if(!approved||approved.status!=='APPROVED'||approved.kind!=='CANCEL_SALE'){
        throw new Error('Annulation préalablement approuvée requise.');
      }
      await post('/approvals/sales/'+cancelSale+'/cancel',props.token,{
        approvalId:cancelId,returnedImei,refundMethod,requestId,
      });
      setMessage('Annulation contrôlée de la vente #'+cancelSale+' enregistrée.');
      setCancelId('');setCancelSale('');setReturnedImei('');setRequestId(validUuid());
      approvals.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  if(props.preview)return <Panel title="Validations">
    <Empty>Les demandes et décisions sont disponibles après authentification.</Empty>
  </Panel>;
  return <div className={'smtr-ref '+(agent?'catalog-phone-panel':'')}>
    {message&&<Notice tone="success">{message}</Notice>}
    {(error||approvals.error||sales.error||stock.error||cases.error)&&
      <Notice tone="error">{error||approvals.error||sales.error||stock.error||cases.error}</Notice>}
    {agent&&formView==="request"&&<Panel action={<SmallButton onClick={()=>setFormView(null)}>Retour à la liste</SmallButton>} title="Demander une validation Manager" subtitle="Remise, annulation ou résolution SAV">
      <form className="catalog-form" onSubmit={requestApproval}>
        <Field label="Type de demande">
          <select value={kind} onChange={e=>setKind(e.target.value)}>
            <option value="DISCOUNT">Remise exceptionnelle</option>
            <option value="CANCEL_SALE">Annulation de vente</option>
            <option value="SAV_RESOLUTION">Résolution SAV</option>
          </select>
        </Field>
        {kind==='DISCOUNT'&&<>
          <Field label="IMEI de l’article (disponible)">
            <select required value={itemId} onChange={e=>setItemId(e.target.value)}>
              <option value="">Choisir un produit</option>
              {stock.data?.items.map(i=><option value={i.id} key={i.id}>{i.name} · {i.imeiMasked}</option>)}
            </select>
          </Field>
          <Field label="Remise demandée (%)">
            <input required type="number" min={1} max={100} value={discount} onChange={e=>setDiscount(e.target.value)}/>
          </Field>
        </>}
        {kind==='CANCEL_SALE'&&<Field label="Vente à annuler">
          <select required value={saleId} onChange={e=>setSaleId(e.target.value)}>
            <option value="">Choisir une vente</option>
            {sales.data?.items.filter(s=>s.status==='COMPLETED').map(s=><option value={s.id} key={s.id}>#{s.id} · {s.title}</option>)}
          </select>
        </Field>}
        {kind==='SAV_RESOLUTION'&&<>
          <Field label="Dossier SAV">
            <select required value={caseId} onChange={e=>setCaseId(e.target.value)}>
              <option value="">Choisir un dossier</option>
              {cases.data?.cases.filter(c=>['OPEN','IN_PROGRESS'].includes(c.status)).map(c=>
                <option value={c.id} key={c.id}>#{c.id} · {c.product} · {c.imeiMasked}</option>)}
            </select>
          </Field>
          <Field label="Résolution proposée">
            <select value={resolution} onChange={e=>setResolution(e.target.value)}>
              <option value="REPAIR">Réparation</option>
              <option value="EXCHANGE">Échange</option>
              <option value="REFUND">Remboursement</option>
            </select>
          </Field>
        </>}
        <Field label="Justification détaillée">
          <textarea required rows={3} minLength={8} maxLength={500} value={reason}
            onChange={e=>setReason(e.target.value)}/>
        </Field>
        <SubmitButton disabled={busy}>{busy?'Envoi…':'Soumettre au Manager'}</SubmitButton>
      </form>
    </Panel>}
    {!formView&&!reviewId&&<>
    <Panel title={agent?'Mes demandes':'Demandes de validation'} subtitle="Traçabilité des décisions et accès selon le rôle"
      action={<SmallButton kind="blue" onClick={()=>setFormView(agent?"request":"cancel")}>{agent?"+ Nouvelle demande":"Annulation après retour"}</SmallButton>}>
      {approvals.loading?<Loading/>:<DataTable
        headers={['N°','TYPE','DEMANDEUR','DATE','STATUT','ACTION']}
        rows={list.map(a=>[
          '#'+a.id,KINDS[a.kind]||a.kind,a.requestedBy,shortDate(a.createdAt),
          <Status label={DECISIONS[a.status]||a.status}/>,
          !agent&&a.status==='PENDING'?
            <SmallButton onClick={()=>{setReviewId(a.id);setDecision('APPROVED');}}>Décider</SmallButton>:
            a.status==='APPROVED'&&a.kind==='DISCOUNT'?'Appliquer à la vente':
              a.status==='APPROVED'&&a.kind==='SAV_RESOLUTION'?'À résoudre dans SAV':'—',
        ])}/>}
    </Panel>
    </>}
        {!agent&&reviewId&&<Panel title={'Validation Manager #'+reviewId}
      subtitle="Code confidentiel requis pour confirmer votre décision">
      <form className="catalog-form" onSubmit={review}>
        <Field label="Décision">
          <select value={decision} onChange={e=>setDecision(e.target.value)}>
            <option value="APPROVED">Approuver</option><option value="REJECTED">Refuser</option>
          </select>
        </Field>
        <Field label="Code de validation Manager (6 chiffres)">
          <input required type="password" inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]{6}" maxLength={6} value={pin}
            onChange={e=>setPin(e.target.value.replace(/\D/g,''))}/>
        </Field>
        <div className="catalog-actions">
          <SmallButton onClick={()=>{setReviewId('');setPin('');}}>Annuler</SmallButton>
          <SubmitButton disabled={busy}>{busy?'Validation…':'Confirmer la décision'}</SubmitButton>
        </div>
      </form>
    </Panel>}
    {!agent&&formView==="cancel"&&<Panel action={<SmallButton onClick={()=>setFormView(null)}>Retour à la liste</SmallButton>} title="Annulation après retour physique" subtitle="Réservé aux ventes avec autorisation approuvée">
      <div className="catalog-warning-box">
        L’annulation modifie le stock et la caisse. Vérifiez le retour physique de l’IMEI avant de confirmer.
      </div>
      <form className="catalog-form" onSubmit={applyCancellation}>
        <Field label="Autorisation approuvée">
          <select required value={cancelId} onChange={e=>{
            setCancelId(e.target.value);
            setCancelSale(list.find(a=>a.id===e.target.value)?.saleId||'');
          }}>
            <option value="">Sélectionner une validation</option>
            {list.filter(a=>a.kind==='CANCEL_SALE'&&a.status==='APPROVED').map(a=>
              <option value={a.id} key={a.id}>#{a.id} · Vente #{a.saleId}</option>)}
          </select>
        </Field>
        <Field label="IMEI physique vérifié (15 à 16 chiffres)">
          <input required pattern="[0-9]{15,16}" value={returnedImei}
            onChange={e=>setReturnedImei(e.target.value.replace(/\D/g,''))}
            placeholder="Scanner ou saisir l’IMEI de l’appareil rendu"/>
        </Field>
        <Field label="Mode de remboursement">
          <select value={refundMethod} onChange={e=>setRefundMethod(e.target.value)}>
            <option value="CASH">Espèces</option><option value="MOBILE_MONEY">Mobile Money</option>
            <option value="TRANSFER">Virement</option>
          </select>
        </Field>
        <SubmitButton disabled={busy||!cancelId}>Annuler la vente après contrôle</SubmitButton>
      </form>
    </Panel>}
  </div>;
}
