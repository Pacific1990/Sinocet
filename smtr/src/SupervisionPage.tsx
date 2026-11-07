import { useState } from 'react';
import { ArrowLeftRight, Boxes, LockKeyhole } from 'lucide-react';
import { DataTable, Empty, Loading, Metric, Notice, Panel, SmallButton, Status, useRemote } from './CatalogueUI';
import { displayError, get, shortDate, type WarehouseCard } from './services';

type Transfer={id:string;status:string;sentAt:string;daysPending:number};
type Item={id:string;imeiMasked:string;product:string;status:string;location:string|null;receivedAt:string};
type Props={token:string|null;preview:boolean;refresh:number;onLogout:()=>void;onNavigate:(id:'inventory'|'transfers')=>void};

export default function SupervisionPage(props:Props){
  const request=useRemote<{warehouses:WarehouseCard[];transfers:Transfer[]}>(
    props.token,'/supervision',props.refresh,props.onLogout
  );
  const [selected,setSelected]=useState('');
  const [details,setDetails]=useState<Item[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const warehouses=request.data?.warehouses||[];
  const total=warehouses.reduce((n,w)=>n+w.available,0);
  const transit=warehouses.reduce((n,w)=>n+w.transit,0);
  const sav=warehouses.reduce((n,w)=>n+w.sav,0);
  const hold=warehouses.reduce((n,w)=>n+w.hold,0);
  async function select(id:string){
    if(!props.token)return;
    setSelected(id);setError('');setLoading(true);
    try{
      const response=await get<{items:Item[]}>('/supervision/'+id+'/items',props.token);
      setDetails(response.items);
    }catch(e){setError(displayError(e,props.onLogout));}
    finally{setLoading(false);}
  }
  if(props.preview)return <Panel title="Cartographie du stock">
    <Empty>Les stocks sont présentés par emplacement physique et statut métier.</Empty>
  </Panel>;
  return <div className="smtr-ref">
    {(error||request.error)&&<Notice tone="error">{error||request.error}</Notice>}
    <div className="catalog-metrics">
      <Metric label="ARTICLES DISPONIBLES" value={total}/>
      <Metric label="EN TRANSIT" value={transit}/>
      <Metric label="GELÉS" value={hold}/>
      <Metric label="STOCK RAMBA" value={sav}/>
    </div>
    <Panel title="Cartographie des stocks" subtitle="Entrepôts physiques, agents, transit et SAV">
      {request.loading?<Loading/>:!warehouses.length?
        <Empty>Aucun entrepôt actif enregistré.</Empty>:
        <div className="catalog-warehouse-map">
          {warehouses.map(w=><button type="button" key={w.id}
            onClick={()=>select(w.id)} className={'catalog-warehouse-card '+(w.kind==='SAV'?'sav':w.frozen?'alert':w.transit?'transit':'')}>
            <strong>{w.kind==='CENTRAL'?'Stock Central':w.kind==='SAV'?'Entrepôt Ramba':'Stock Agent'}</strong>
            <span>{w.name} {w.agent?' · '+w.agent:''}</span>
            <b>{w.available}</b>
            <div className="metrics">
              <span><Boxes size={13}/> Disponible</span>
              {w.frozen?<span><LockKeyhole size={13}/> Gelé</span>:w.transit?
                <span><ArrowLeftRight size={13}/> {w.transit} en transit</span>:null}
            </div>
            <small>Ouvrir le détail du stock</small>
          </button>)}
        </div>}
      <p className="catalog-note">Articles « En transit », « SAV » et « Gelés » exclus des produits vendables.</p>
    </Panel>
    {selected&&<Panel title={'Détail · '+(warehouses.find(w=>w.id===selected)?.name||'Stock')}
      action={<SmallButton onClick={()=>setSelected('')}>Fermer</SmallButton>}>
      {loading?<Loading/>:
        <DataTable headers={['IMEI','PRODUIT','STATUT','EMPLACEMENT','DATE']}
          rows={details.map(i=>[
            i.imeiMasked,i.product,<Status label={i.status}/>,i.location||'—',shortDate(i.receivedAt),
          ])}/>}
      <div className="catalog-actions">
        <SmallButton onClick={()=>props.onNavigate('inventory')}><LockKeyhole size={16}/> Gérer inventaire & gel</SmallButton>
        <SmallButton onClick={()=>props.onNavigate('transfers')}><ArrowLeftRight size={16}/> Transferts</SmallButton>
      </div>
    </Panel>}
    <Panel title="Transferts en attente" subtitle="Suivi des mouvements et délais">
      <DataTable headers={['N°','ÉTAT','DÉPART','EN ATTENTE']}
        rows={(request.data?.transfers||[]).map(t=>[
          '#'+t.id,<Status label={t.status==='IN_TRANSIT'?'En transit':'Écart signalé'}/>,
          shortDate(t.sentAt),t.daysPending+' jour(s)',
        ])}/>
    </Panel>
  </div>;
}
