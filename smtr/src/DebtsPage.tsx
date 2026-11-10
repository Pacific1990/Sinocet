import { useMemo, useState, type FormEvent } from 'react';
import { MessageCircle, FileText } from 'lucide-react';
import { DataTable, Empty, Field, Filters, Loading, Metric, Notice, Panel, SmallButton, Status, SubmitButton, useRemote } from './CatalogueUI';
import { displayError, exportFile, fcfa, get, patch, post, shortDate, validUuid, type Debt, type Person } from './services';
import type { Role } from './permissions';

type Props={role:Role;token:string|null;preview:boolean;refresh:number;onLogout:()=>void;onRefresh:()=>void};
type DebtsResponse={debts:Debt[];summary:{outstandingF:number;overdueCount:number;customerCount:number;overdueCustomersCount:number;recoveredThisMonthF:number}};

export default function DebtsPage(props:Props){
  const agent=props.role==='agent';
  const debts=useRemote<DebtsResponse>(props.token,'/debts',props.refresh,props.onLogout);
  const clients=useRemote<{customers:Person[]}>(props.token,'/customers',props.refresh,props.onLogout);
  const [filter,setFilter]=useState<'all'|'pending'|'overdue'|'paid'>('all');
  const [search,setSearch]=useState('');
  const [showClient,setShowClient]=useState(false);
  const [showLimit,setShowLimit]=useState(false);
  const [name,setName]=useState('');
  const [phone,setPhone]=useState('');
  const [selected,setSelected]=useState('');
  const [received,setReceived]=useState('');
  const [method,setMethod]=useState('CASH');
  const [reference,setReference]=useState('');
  const [requestId,setRequestId]=useState(validUuid);
  const [limitId,setLimitId]=useState('');
  const [limit,setLimit]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [receiptId,setReceiptId]=useState('');
  const [error,setError]=useState('');
  const [reminder,setReminder]=useState<{message:string;phone:string;whatsappUrl:string|null}|null>(null);
  const available=debts.data?.debts||[];
  const filtered=useMemo(()=>available.filter(d=>{
    const match=filter==='all' ||
      filter==='pending'&&d.status==='À venir'||
      filter==='overdue'&&d.status==='Dépassée'||
      filter==='paid'&&d.status==='Payé';
    return match&&(d.customer+' '+d.agent+' '+d.saleId).toLowerCase().includes(search.toLowerCase());
  }),[available,filter,search]);
  const totals=debts.data?.summary;
  const selectedDebt=available.find(d=>d.id===selected);

  async function createCustomer(event:FormEvent){
    event.preventDefault();if(!agent||!props.token||busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      await post('/customers',props.token,{
        name,phone:phone||null
      });
      setName('');setPhone('');setShowClient(false);
      setMessage('Client ajouté. Le plafond de crédit reste à zéro jusqu’à validation du responsable.');
      clients.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }

  async function repay(event:FormEvent){
    event.preventDefault();if(!props.token||busy||!selectedDebt)return;
    setBusy(true);setError('');setMessage('');
    try{
      const r=await post<{payment:{id:string;remainingF:number}}>('/debts/'+selected+'/payments',props.token,{
        amountF:Number(received),method,reference:reference||null,requestId,
      });
      setMessage('Paiement #'+r.payment.id+' enregistré. Solde : '+fcfa(r.payment.remainingF));
      setReceiptId(r.payment.id);
      setSelected('');setReceived('');setReference('');setRequestId(validUuid());
      debts.reload();clients.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }

  async function updateLimit(event:FormEvent){
    event.preventDefault();if(!props.token||busy||!limitId)return;
    setBusy(true);setError('');setMessage('');
    try{
      await patch('/customers/'+limitId+'/limit',props.token,{creditLimitF:Number(limit)});
      setLimitId('');setLimit('');setMessage('Plafond du client mis à jour.');
      clients.reload();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }

  async function openReminder(id:string){
    if(!props.token)return;
    setError('');setReminder(null);
    try{
      const data=await get<{message:string;phone:string;whatsappUrl:string|null}>('/debts/'+id+'/reminder',props.token);
      setReminder(data);
    }catch(e){setError(displayError(e,props.onLogout));}
  }
  async function downloadReceipt(id:string){
    if(!props.token)return;
    try{await exportFile('/payments/'+id+'/receipt',props.token,'smtr-recu-remboursement-'+id+'.pdf');}
    catch(e){setError(displayError(e,props.onLogout));}
  }
  if(props.preview)return <Panel title="Dettes & crédits" subtitle="Échéances et encaissements réels">
    <Empty>Connectez-vous pour consulter les dossiers clients autorisés.</Empty>
  </Panel>;

  return <div className={'smtr-ref '+(agent?'catalog-phone-panel':'')}>
    {message&&<Notice tone="success">{message}</Notice>}
    {receiptId&&<div className="catalog-actions" style={{marginBottom:14}}>
      <SmallButton kind="blue" onClick={()=>downloadReceipt(receiptId)}>
        <FileText size={16}/> Télécharger le reçu du remboursement #{receiptId}
      </SmallButton>
    </div>}
    {error&&<Notice tone="error">{error}</Notice>}
    {(debts.error||clients.error)&&<Notice tone="error">{debts.error||clients.error}</Notice>}
    <div className="catalog-metrics">
      <Metric label="CRÉANCES EN COURS" value={fcfa(totals?.outstandingF)}/>
      <Metric label="ÉCHÉANCES DÉPASSÉES" value={totals?.overdueCount||0}/>
      <Metric label="CLIENTS DÉBITEURS" value={totals?.customerCount||0}/>
      {!agent&&<>
        <Metric label="CLIENTS EN DÉPASSEMENT" value={totals?.overdueCustomersCount||0}/>
        <Metric label="RECOUVRÉ CE MOIS" value={fcfa(totals?.recoveredThisMonthF)}/>
      </>}
    </div>
    {!selectedDebt&&!showLimit&&<>
    <Panel title={showClient?"Nouveau client":agent?"Mes crédits clients":"Suivi des crédits"} subtitle="Créances et échéances, selon votre périmètre"
      action={<>{!agent&&!showClient&&<SmallButton onClick={()=>setShowLimit(true)}>Plafonds de crédit</SmallButton>}{agent&&<SmallButton kind="blue" onClick={()=>setShowClient(x=>!x)}>{showClient?"Retour à la liste":"+ Ajouter un client"}</SmallButton>}</>}>
      {showClient&&<form className="catalog-form catalog-inner-panel" onSubmit={createCustomer}>
        <h3 className="catalog-card-title">Nouveau client</h3>
        <div className="catalog-form-row">
          <Field label="Nom du client"><input required minLength={2} maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></Field>
          <Field label="Téléphone (facultatif)">
            <input type="tel" minLength={6} maxLength={30} value={phone} onChange={e=>setPhone(e.target.value)}/>
          </Field>
        </div>
        <SubmitButton disabled={busy}>{busy?'Enregistrement…':'Enregistrer le client'}</SubmitButton>
      </form>}
      {!showClient&&<>
      <div className="catalog-tab-group">
        {([['all','Tous'],['pending','À venir'],['overdue','Dépassées'],['paid','Payées']] as const)
          .map(([id,label])=><button type="button" key={id} className={'catalog-tab '+(filter===id?'active':'')}
            onClick={()=>setFilter(id)}>{label}</button>)}
      </div>
      <Filters><Field label="Rechercher un dossier"><input value={search} onChange={e=>setSearch(e.target.value)}
        placeholder="Client, agent, numéro de vente"/></Field></Filters>
      {debts.loading?<Loading/>:<DataTable
        headers={['CLIENT','INITIAL','RESTE DÛ','ÉCHÉANCE','STATUT','ACTIONS']}
        rows={filtered.map(d=>[
          <div><strong>{d.customer}</strong><small>{agent?'Vente #'+d.saleId:d.agent}</small></div>,
          fcfa(d.initialAmountF),<strong>{fcfa(d.amountF)}</strong>,shortDate(d.dueDate),
          <Status label={d.status}/>,
          <div className="catalog-actions">
            {agent&&d.status!=='Payé'&&d.status!=='Annulé'&&
              <SmallButton onClick={()=>{setSelected(d.id);setReceived(String(d.amountF));}}>Encaisser</SmallButton>}
            {d.status!=='Payé'&&d.status!=='Annulé'&&<SmallButton onClick={()=>openReminder(d.id)}>
              <MessageCircle size={15}/> Relancer</SmallButton>}
          </div>,
        ])}/>}
    </>}
    </Panel>
    </>}
        {agent&&selectedDebt&&<Panel title={'Encaissement — '+selectedDebt.customer}
      subtitle={'Restant dû : '+fcfa(selectedDebt.amountF)}>
      <form className="catalog-form" onSubmit={repay}>
        <div className="catalog-form-row">
          <Field label="Montant reçu en FCFA">
            <input type="number" required min={1} max={selectedDebt.amountF} value={received} onChange={e=>setReceived(e.target.value)}/>
          </Field>
          <Field label="Mode de paiement">
            <select value={method} onChange={e=>setMethod(e.target.value)}>
              <option value="CASH">Espèces</option><option value="MOBILE_MONEY">Mobile Money</option>
              <option value="TRANSFER">Virement</option>
            </select>
          </Field>
          <Field label="Référence paiement (facultative)">
            <input value={reference} maxLength={120} onChange={e=>setReference(e.target.value)}/>
          </Field>
        </div>
        <div className="catalog-actions">
          <SmallButton onClick={()=>setSelected('')}>Annuler</SmallButton>
          <SubmitButton disabled={busy}>{busy?'Validation…':'Valider le paiement'}</SubmitButton>
        </div>
      </form>
    </Panel>}
    {!agent&&showLimit&&<Panel action={<SmallButton onClick={()=>setShowLimit(false)}>Retour à la liste</SmallButton>} title="Plafonds de crédit" subtitle="Autorisation préalable obligatoire pour toute vente à crédit">
      <form className="catalog-form" onSubmit={updateLimit}>
        <div className="catalog-form-row">
          <Field label="Client">
            <select required value={limitId} onChange={e=>{
              setLimitId(e.target.value);
              setLimit(String(clients.data?.customers.find(c=>c.id===e.target.value)?.creditLimitF||0));
            }}>
              <option value="">Sélectionner un client</option>
              {clients.data?.customers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.agentName}</option>)}
            </select>
          </Field>
          <Field label="Plafond autorisé (FCFA)">
            <input type="number" required min={0} value={limit} onChange={e=>setLimit(e.target.value)}/>
          </Field>
        </div>
        <SubmitButton disabled={busy||!limitId}>Enregistrer le plafond</SubmitButton>
      </form>
    </Panel>}
    {reminder&&<Panel title="Relance client" subtitle="Message à envoyer après vérification du destinataire">
      <div className="catalog-warning-box">{reminder.message}</div>
      <div className="catalog-actions">
        {reminder.whatsappUrl?<a className="ref-button ref-button--blue"
          href={reminder.whatsappUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={17}/> Ouvrir WhatsApp</a>:
          <Notice tone="warning">Le client n’a pas de numéro enregistré.</Notice>}
        {reminder.phone&&<a className="ref-button ref-button--outline"
          href={'sms:+'+reminder.phone+'?body='+encodeURIComponent(reminder.message)}>
          SMS prérempli</a>}
        <SmallButton onClick={()=>{
          void navigator.clipboard?.writeText(reminder.message);setMessage('Texte de relance copié.');
        }}>Copier le message</SmallButton>
      </div>
      <p className="catalog-note">Le message n’est pas envoyé automatiquement par SMTR.</p>
    </Panel>}
  </div>;
}
