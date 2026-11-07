import { useState, type FormEvent } from 'react';
import { DataTable, Empty, Field, Loading, Metric, Notice, Panel, SubmitButton, useRemote } from './CatalogueUI';
import { displayError, fcfa, post, shortDate } from './services';
import type { Role } from './permissions';

type Totals={cashF:number;mobileF:number;transferF:number;totalF:number};
type Payment={id:string;amountF:number;method:string;kind:string;createdAt:string;reference:string|null};
type Today={
  day:string;agentId:string;expected:Totals;
  closed:null|{id:string;closedAt:string;declared:Totals};
  transactions:Payment[];
};
type Closure={id:string;day:string;agent:string;closedAt:string;expectedF:number;declaredF:number};
type Props={role:Role;token:string|null;preview:boolean;refresh:number;onLogout:()=>void;onRefresh:()=>void};

export default function CashPage(props:Props){
  const agent=props.role==='agent';
  const request=useRemote<Today>(agent?props.token:null,'/cash/today',props.refresh,props.onLogout);
  const history=useRemote<{closures:Closure[]}>(props.token,'/cash/history',props.refresh,props.onLogout);
  const [cash,setCash]=useState('');
  const [mobile,setMobile]=useState('');
  const [transfer,setTransfer]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const expected=request.data?.expected;
  async function close(event:FormEvent){
    event.preventDefault();if(!props.token||busy)return;
    if(!window.confirm('Confirmez-vous les montants comptés ? La caisse sera verrouillée pour cette journée.'))return;
    setBusy(true);setError('');setMessage('');
    try{
      const result=await post<{closure:{id:string;day:string}}>('/cash/close',props.token,{
        declaredCashF:Number(cash),declaredMobileF:Number(mobile),declaredTransferF:Number(transfer),
      });
      setMessage('Clôture #'+result.closure.id+' enregistrée. Aucune nouvelle vente n’est autorisée pour cette journée.');
      request.reload();history.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  if(props.preview)return <Panel title="Ma caisse" subtitle="Encaissements réels — aucun solde fictif">
    <Empty>Connectez-vous pour consulter la caisse.</Empty>
  </Panel>;
  return <div className={'smtr-ref '+(agent?'catalog-phone-panel':'')}>
    {message&&<Notice tone="success">{message}</Notice>}
    {(error||request.error||history.error)&&<Notice tone="error">{error||request.error||history.error}</Notice>}
    {agent&&<>
      <div className="catalog-cash-total"><small>ENCAISSEMENTS COMPTABILISÉS DU JOUR</small>
        <strong>{fcfa(expected?.totalF)}</strong>
      </div>
      <div className="catalog-metrics">
        <Metric label="ESPÈCES" value={fcfa(expected?.cashF)}/>
        <Metric label="MOBILE MONEY" value={fcfa(expected?.mobileF)}/>
        <Metric label="VIREMENTS" value={fcfa(expected?.transferF)}/>
      </div>
      <Panel title="Clôture de la caisse" subtitle={request.data?.day||'Journée courante'}>
        {request.loading?<Loading/>:request.data?.closed?
          <Notice tone="success">Caisse clôturée le {shortDate(request.data.closed.closedAt)}.
            Montant déclaré : {fcfa(request.data.closed.declared.totalF)}.
          </Notice>:
          <form className="catalog-form" onSubmit={close}>
            <p className="catalog-note">Renseignez les montants réellement détenus. Les écarts seront tracés dans le journal d’audit.</p>
            <div className="catalog-form-row">
              <Field label="Espèces comptées (FCFA)"><input type="number" min={0} required value={cash} onChange={e=>setCash(e.target.value)}/></Field>
              <Field label="Mobile Money confirmé (FCFA)"><input type="number" min={0} required value={mobile} onChange={e=>setMobile(e.target.value)}/></Field>
              <Field label="Virements confirmés (FCFA)"><input type="number" min={0} required value={transfer} onChange={e=>setTransfer(e.target.value)}/></Field>
            </div>
            <SubmitButton disabled={busy}>{busy?'Clôture…':'Valider la clôture'}</SubmitButton>
          </form>}
      </Panel>
      <Panel title="Mouvements de caisse du jour" subtitle="Encaissements enregistrés côté serveur">
        {request.loading?<Loading/>:<DataTable
          headers={['DATE','TYPE','MODE','MONTANT','RÉFÉRENCE']}
          rows={(request.data?.transactions||[]).map(x=>[
            shortDate(x.createdAt),x.kind,x.method,
            <strong>{x.kind==='REFUND'?'-':''}{fcfa(x.amountF)}</strong>,x.reference||'—',
          ])}/>}
      </Panel>
    </>}
    <Panel title={agent?'Mes clôtures':'Historique des clôtures'} subtitle="Comparaison montants attendus et déclarés">
      {history.loading?<Loading/>:<DataTable
        headers={['DATE','AGENT','ATTENDU','DÉCLARÉ','ÉCART']}
        rows={(history.data?.closures||[]).map(x=>[
          shortDate(x.day),x.agent,fcfa(x.expectedF),fcfa(x.declaredF),
          <span className={x.declaredF!==x.expectedF?'catalog-negative':'catalog-positive'}>
            {fcfa(x.declaredF-x.expectedF)}
          </span>,
        ])}/>}
    </Panel>
  </div>;
}
