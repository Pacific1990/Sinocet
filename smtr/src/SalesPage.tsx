import { useEffect, useState, type FormEvent } from 'react';
import { FileText, ShoppingBag } from 'lucide-react';
import { DataTable, Empty, Field, Loading, Metric, Notice, Panel, SmallButton, Status, SubmitButton, useRemote } from './CatalogueUI';
import { displayError, exportFile, fcfa, post, shortDate, validUuid, type Person, type Sale, type SaleItem, type Approval } from './services';
import { addDraft, deleteDraft, listDrafts, type OfflineSaleDraft } from './offline';
import type { Role } from './permissions';
import ImeiScanner from './ImeiScanner';

type Props={role:Role;initialCreate?:boolean;token:string|null;userId:string;preview:boolean;refresh:number;onLogout:()=>void;onRefresh:()=>void};
type Method='CASH'|'MOBILE_MONEY'|'TRANSFER'|'CREDIT';

export default function SalesPage(props:Props){
  const agent=props.role==='agent';
  const list=useRemote<{items:Sale[]}>(props.token,'/sales',props.refresh,props.onLogout);
  const [debouncedQuery,setDebouncedQuery]=useState('');
  const stock=useRemote<{items:SaleItem[]}>(agent?props.token:null,
    '/sales/stock?q='+encodeURIComponent(debouncedQuery),props.refresh,props.onLogout);
  const customers=useRemote<{customers:Person[]}>(agent?props.token:null,'/customers',props.refresh,props.onLogout);
  const approvals=useRemote<{approvals:Approval[]}>(agent?props.token:null,'/approvals/mine',props.refresh,props.onLogout);
  const [query,setQuery]=useState('');
  const [itemId,setItemId]=useState('');
  const [method,setMethod]=useState<Method>('CASH');
  const [customerId,setCustomerId]=useState('');
  const [paid,setPaid]=useState('');
  const [dueDate,setDueDate]=useState('');
  const [reference,setReference]=useState('');
  const [collectedVia,setCollectedVia]=useState('CASH');
  const [approvalId,setApprovalId]=useState('');
  const [requestId,setRequestId]=useState(validUuid);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [saleId,setSaleId]=useState('');
  const [drafts,setDrafts]=useState<OfflineSaleDraft[]>([]);
  const [offlineBusy,setOfflineBusy]=useState(false);
  const [showForm,setShowForm]=useState(agent&&Boolean(props.initialCreate));
  const rows=list.data?.items||[];
  const available=stock.data?.items||[];
  const filtered=available;
  useEffect(()=>{
    const timer=window.setTimeout(()=>setDebouncedQuery(query),250);
    return()=>window.clearTimeout(timer);
  },[query]);
  useEffect(()=>{
    if(/^\d{15,16}$/.test(debouncedQuery)&&available.length===1){
      setItemId(available[0].id);
    }
  },[debouncedQuery,stock.data]);
  const item=available.find(x=>x.id===itemId);
  const gross=item?.priceF??0;
  const discounts=(approvals.data?.approvals||[]).filter(a=>a.kind==='DISCOUNT'&&a.status==='APPROVED'&&a.itemId===itemId);
  const selectedDiscount=discounts.find(a=>a.id===approvalId);
  const total=gross-Math.round(gross*Number(selectedDiscount?.discountPercent||0)/100);
  const alreadyPaid=method==='CREDIT'?Number(paid||0):total;
  const remaining=Math.max(0,total-alreadyPaid);

  useEffect(()=>{
    if(!agent||!props.userId)return;
    let mounted=true;
    listDrafts(props.userId).then(result=>{if(mounted)setDrafts(result);}).catch(()=>undefined);
    return()=>{mounted=false;};
  },[agent,props.userId,props.refresh]);

  const requestBody=()=>({
    itemId,customerId:customerId||null,approvalId:approvalId||undefined,
    requestId,paymentMethod:method,paidAmountF:alreadyPaid,
    ...(method==='CREDIT'?{dueDate,collectedVia:alreadyPaid>0?collectedVia:undefined}:{}),
    paymentReference:reference||null,
  });

  function reset(){
    setRequestId(validUuid());setItemId('');setQuery('');setPaid('');
    setDueDate('');setReference('');setCustomerId('');setApprovalId('');setMethod('CASH');
  }

  async function submit(event:FormEvent){
    event.preventDefault();if(!props.token||busy||!item||!customerId)return;
    setBusy(true);setError('');setMessage('');setSaleId('');
    try{
      if(!navigator.onLine){
        // A draft is NOT a sale. It creates neither a receipt nor a stock movement.
        await addDraft({
          requestId,ownerId:props.userId,itemId,customerId:customerId||null,
          approvalId:approvalId||undefined,
          paymentMethod:method,paidAmountF:alreadyPaid,
          ...(method==='CREDIT'?{dueDate,collectedVia}:{}),
          paymentReference:reference||undefined,createdAt:Date.now(),
        });
        setMessage('Brouillon enregistré hors ligne. Aucune vente ni réservation n’a été validée.');
        setDrafts(await listDrafts(props.userId));reset();return;
      }
      const r=await post<{sale:{id:string;replayed:boolean}}>('/sales',props.token,requestBody());
      setSaleId(r.sale.id);
      setMessage('Vente #'+r.sale.id+' enregistrée et stock mis à jour.');
      reset();stock.reload();list.reload();customers.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }

  async function resubmitDraft(draft:OfflineSaleDraft){
    if(!props.token||offlineBusy||!navigator.onLine)return;
    setOfflineBusy(true);setError('');setMessage('');
    try{
      const r=await post<{sale:{id:string}}>('/sales',props.token,{
        itemId:draft.itemId,customerId:draft.customerId,approvalId:draft.approvalId,
        requestId:draft.requestId,paymentMethod:draft.paymentMethod,
        paidAmountF:draft.paidAmountF,
        ...(draft.paymentMethod==='CREDIT'?{dueDate:draft.dueDate,collectedVia:draft.collectedVia}:{}),
        paymentReference:draft.paymentReference||null,
      });
      await deleteDraft(draft.requestId);
      setDrafts(await listDrafts(props.userId));
      setMessage('Brouillon validé par le serveur : vente #'+r.sale.id+'.');
      setSaleId(r.sale.id);stock.reload();list.reload();props.onRefresh();
    }catch(e){
      setError('Brouillon conservé : '+displayError(e,props.onLogout)+
        ' Vérifiez le prix, les IMEI, le crédit et la disponibilité avant de réessayer.');
    }finally{setOfflineBusy(false);}
  }

  async function download(id:string){
    if(!props.token)return;
    try{await exportFile('/sales/'+id+'/receipt',props.token,'smtr-recu-'+id+'.pdf');}
    catch(e){setError(displayError(e,props.onLogout));}
  }

  const totals={
    count:rows.filter(r=>r.status==='COMPLETED').length,
    revenue:rows.filter(r=>r.status==='COMPLETED').reduce((n,r)=>n+r.totalAmountF,0),
    credits:rows.filter(r=>r.status==='COMPLETED').reduce((n,r)=>n+r.creditAmountF,0),
  };
  if(props.preview)return <Panel title="Point de vente" subtitle="Page conforme aux parcours Agent du catalogue">
    <Empty>Connectez-vous pour accéder au stock réel et aux transactions.</Empty>
  </Panel>;
  return <div className={'smtr-ref '+(agent?'catalog-phone-panel':'')}>
    {message&&<Notice tone="success">{message}</Notice>}
    {error&&<Notice tone="error">{error}</Notice>}
    {(list.error||stock.error||customers.error)&&
      <Notice tone="error">{list.error||stock.error||customers.error}</Notice>}
    {!agent&&<div className="catalog-metrics">
      <Metric label="VENTES AFFICHÉES" value={totals.count}/>
      <Metric label="CHIFFRE D’AFFAIRES" value={fcfa(totals.revenue)}/>
      <Metric label="CRÉDITS ACCORDÉS" value={fcfa(totals.credits)}/>
    </div>}
    {agent&&showForm&&<Panel title="Nouvelle vente" subtitle="Un IMEI disponible ne peut être vendu qu’une seule fois"
      action={<SmallButton onClick={()=>setShowForm(false)}>Retour à la liste</SmallButton>}>
      <form className="catalog-form" onSubmit={submit}>
        <Field label="Rechercher un produit ou scanner son IMEI">
          <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nom du produit ou IMEI" autoComplete="off"/>
        </Field>
        <ImeiScanner onScan={setQuery} disabled={busy}/>
        <Field label="Choisir l’appareil réellement disponible">
          <select required value={itemId} onChange={e=>{setItemId(e.target.value);setApprovalId('');setRequestId(validUuid());}}>
            <option value="">— Sélectionnez un article —</option>
            {filtered.map(p=><option key={p.id} value={p.id}>
              {p.name} · IMEI {p.imeiMasked} · {p.priceF===null?'Prix non fixé':fcfa(p.priceF)}
            </option>)}
          </select>
        </Field>
        {item&&<div className="catalog-cash-total">
          <small>PRIX DE VENTE CONFIGURÉ</small>
          <strong>{item.priceF===null?'À définir par la Direction':fcfa(total)}</strong>
          {selectedDiscount&&<small>Remise : {selectedDiscount.discountPercent}%</small>}
        </div>}
        <Field label="Client">
          <select required value={customerId} onChange={e=>setCustomerId(e.target.value)}>
            <option value="">Sélectionner un client</option>
            {customers.data?.customers.map(c=><option key={c.id} value={c.id}>
              {c.name} · plafond {fcfa(c.creditLimitF)} · dû {fcfa(c.balanceF)}
            </option>)}
          </select>
        </Field>
        <div className="catalog-form-row">
          <Field label="Mode de paiement">
            <select value={method} onChange={e=>{setMethod(e.target.value as Method);setRequestId(validUuid());}}>
              <option value="CASH">Espèces</option>
              <option value="MOBILE_MONEY">Mobile Money</option>
              <option value="TRANSFER">Virement</option>
              <option value="CREDIT">Crédit</option>
            </select>
          </Field>
          {method!=='CASH'&&method!=='CREDIT'&&
            <Field label="Référence de paiement"><input value={reference} onChange={e=>setReference(e.target.value)} maxLength={120}/></Field>}
        </div>
        {method==='CREDIT'&&<>
          <div className="catalog-form-row">
            <Field label="Échéance de paiement"><input type="date" required value={dueDate} onChange={e=>setDueDate(e.target.value)}/></Field>
            <Field label="Montant encaissé immédiatement (FCFA)">
              <input type="number" min={0} max={total} value={paid} required onChange={e=>setPaid(e.target.value)}/>
            </Field>
            <Field label="Canal d’encaissement immédiat">
              <select value={collectedVia} onChange={e=>setCollectedVia(e.target.value)}>
                <option value="CASH">Espèces</option><option value="MOBILE_MONEY">Mobile Money</option>
                <option value="TRANSFER">Virement</option>
              </select>
            </Field>
          </div>
          <div className="catalog-warning-box">
            Reste à crédit : <strong>{fcfa(remaining)}</strong>. Le serveur vérifie les plafonds du client et de l’agent.
          </div>
        </>}
        <Field label="Remise approuvée (facultatif)">
          <select value={approvalId} onChange={e=>{setApprovalId(e.target.value);setRequestId(validUuid());}}>
            <option value="">Sans remise</option>
            {discounts.map(a=><option key={a.id} value={a.id}>Validation #{a.id} - {a.discountPercent}%</option>)}
          </select>
        </Field>
        <SubmitButton disabled={busy||!item||!customerId||item.priceF===null||item.priceF<=0||
          method==='CREDIT'&&(!dueDate||!(remaining>0))}>
          <ShoppingBag size={17}/>{busy?'Enregistrement…':navigator.onLine?'Enregistrer la vente':'Enregistrer un brouillon hors ligne'}
        </SubmitButton>
        <p className="catalog-hint">Le paiement Mobile Money est enregistré après confirmation de l’agent ; aucune opération de débit externe n’est déclenchée automatiquement.</p>
      </form>
      {saleId&&<div style={{marginTop:14}}><SmallButton onClick={()=>download(saleId)}><FileText size={16}/> Télécharger le reçu PDF #{saleId}</SmallButton></div>}
    </Panel>}
    {!showForm&&<>
    {agent&&drafts.length>0&&<Panel title={'Brouillons hors ligne ('+drafts.length+')'} subtitle="Non validés, sans sortie du stock ni reçu">
      {drafts.map(d=><article key={d.requestId} className="catalog-pending-draft">
        <div className="catalog-row">
          <span>Article #{d.itemId} · {d.paymentMethod}</span>
          <strong>{shortDate(new Date(d.createdAt).toISOString())}</strong>
        </div>
        <div className="catalog-actions">
          <SmallButton kind="blue" disabled={offlineBusy||!navigator.onLine} onClick={()=>resubmitDraft(d)}>
            Valider après reconnexion
          </SmallButton>
          <SmallButton disabled={offlineBusy} onClick={async()=>{
            await deleteDraft(d.requestId);setDrafts(await listDrafts(props.userId));
          }}>Supprimer</SmallButton>
        </div>
      </article>)}
      <p className="catalog-note">Le stock et les prix sont recontrôlés au moment de la validation serveur. Une vente conflictuelle reste un brouillon et doit être résolue.</p>
    </Panel>}
    <Panel title={agent?'Mes ventes':'Historique des ventes'} subtitle="Transactions réellement enregistrées et contrôlées par l’API"
      action={agent&&<SmallButton kind="blue" onClick={()=>setShowForm(true)}>+ Nouvelle vente</SmallButton>}>
      {list.loading?<Loading/>:
        <DataTable headers={['DATE','PRODUIT','MONTANT','CRÉDIT','ÉTAT','REÇU']}
          rows={rows.map(r=>[
            shortDate(r.createdAt),r.title,fcfa(r.totalAmountF),fcfa(r.creditAmountF),
            <Status label={r.status==='COMPLETED'?'Validée':'Annulée'}/>,
            <SmallButton onClick={()=>download(r.id)}><FileText size={15}/> PDF</SmallButton>
          ])}/>}
    </Panel></>}

  </div>;
}
