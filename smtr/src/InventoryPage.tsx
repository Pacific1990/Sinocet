import { useEffect, useState, type FormEvent } from 'react';
import { Boxes, LockKeyhole } from 'lucide-react';
import { DataTable, Empty, Field, Loading, Metric, Notice, Panel, SmallButton, Status, SubmitButton, useRemote } from './CatalogueUI';
import { displayError, get, post, shortDate } from './services';

type Props={token:string|null;preview:boolean;refresh:number;onLogout:()=>void;onRefresh:()=>void};
type AgentStock={warehouseId:string;stockName:string;agentId:string;agentName:string;frozen:boolean;lastInventory:string|null;currentCount:number};
type Inventory={id:string;warehouseId:string;warehouseName:string;agentName:string;status:string;openedAt:string;finishedAt:string|null;note:string|null};
type InventoryDetail=Inventory&{frozen:boolean;reconciledAt:string|null;lines:Array<{productId:string;name:string;expected:number;counted:number|null;difference:number|null}>};

export default function InventoryPage(props:Props){
  const agents=useRemote<{agents:AgentStock[]}>(props.token,'/inventories/agents',props.refresh,props.onLogout);
  const inventories=useRemote<{inventories:Inventory[]}>(props.token,'/inventories',props.refresh,props.onLogout);
  const [warehouseId,setWarehouseId]=useState('');
  const [selected,setSelected]=useState('');
  const [detail,setDetail]=useState<InventoryDetail|null>(null);
  const [counts,setCounts]=useState<Record<string,string>>({});
  const [physicalItems,setPhysicalItems]=useState<Array<{id:string;productId:string;productName:string;imeiMasked:string;state:string}>>([]);
  const [verified,setVerified]=useState<string[]>([]);
  const [reconcileReason,setReconcileReason]=useState('');
  const [note,setNote]=useState('');
  const [freezeReason,setFreezeReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [showStart,setShowStart]=useState(false);
  const chosen=agents.data?.agents.find(a=>a.warehouseId===warehouseId);
  const detailsSelected=Boolean(selected);
  async function loadDetail(id:string){
    if(!props.token)return;
    setError('');
    try{
      const response=await get<{inventory:InventoryDetail}>('/inventories/'+id,props.token);
      setDetail(response.inventory);setSelected(id);
      setCounts(Object.fromEntries(response.inventory.lines.map(l=>[l.productId,String(l.counted??l.expected)])));
      setVerified([]);setPhysicalItems([]);
      if(response.inventory.status==='CLOSED'&&response.inventory.frozen&&
        response.inventory.lines.some(l=>l.counted!==l.expected)){
        const stock=await get<{items:Array<{id:string;productId:string;productName:string;imeiMasked:string;state:string}>}>(
          '/inventories/'+id+'/items',props.token
        );
        setPhysicalItems(stock.items);
      }
    }catch(e){setError(displayError(e,props.onLogout));}
  }
  useEffect(()=>{
    if(!props.token||!selected)return;
    void loadDetail(selected);
    // Intentionally only refresh from server on explicit reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[props.refresh]);
  async function start(event:FormEvent){
    event.preventDefault();if(!props.token||busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      const r=await post<{inventory:{id:string}}>('/inventories/start',props.token,{warehouseId});
      setMessage('Inventaire #'+r.inventory.id+' ouvert : cet agent seulement est gelé.');
      setShowStart(false);agents.reload();inventories.reload();props.onRefresh();
      await loadDetail(r.inventory.id);
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  async function close(event:FormEvent){
    event.preventDefault();if(!props.token||busy||!detail)return;
    if(!window.confirm('Confirmer les quantités physiquement comptées et clôturer cet inventaire ?'))return;
    setBusy(true);setError('');setMessage('');
    try{
      const result=await post<{inventory:{id:string;discrepancy:number;frozen:boolean}}>(
        '/inventories/'+detail.id+'/close',props.token,{
          counts:detail.lines.map(l=>({productId:l.productId,counted:Number(counts[l.productId])})),
          note:note||undefined,
        }
      );
      setMessage('Inventaire #'+detail.id+' clôturé. Écart total : '+result.inventory.discrepancy+
        '. '+(result.inventory.frozen?'Stock maintenu gelé jusqu’à vérification.':'Stock agent dégelé.'));
      setSelected('');setDetail(null);setNote('');
      agents.reload();inventories.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  async function reconcile(event:FormEvent){
    event.preventDefault();if(!props.token||busy||!detail)return;
    if(!window.confirm('Confirmez-vous avoir revérifié physiquement chaque IMEI coché ? Les manquants seront mis en quarantaine.'))return;
    setBusy(true);setMessage('');setError('');
    try{
      const r=await post<{inventory:{id:string;verifiedCount:number;missingCount:number}}>(
        '/inventories/'+detail.id+'/reconcile',props.token,{
          verifiedItemIds:verified,reason:reconcileReason,
        }
      );
      setMessage(r.inventory.verifiedCount+' IMEI vérifiés, '+r.inventory.missingCount+
        ' manquant(s) conservés en HOLD. Le stock contrôlé peut reprendre son activité.');
      setSelected('');setDetail(null);setPhysicalItems([]);setVerified([]);setReconcileReason('');
      agents.reload();inventories.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}
    finally{setBusy(false);}
  }

  async function toggleFreeze(warehouse:AgentStock){
    if(!props.token||busy)return;
    if(!freezeReason.trim()||freezeReason.trim().length<8){setError('Indiquez un motif de 8 caractères minimum avant de geler ou dégeler.');return;}
    setBusy(true);setError('');setMessage('');
    try{
      await post('/inventories/warehouses/'+warehouse.warehouseId+'/freeze',props.token,{
        frozen:!warehouse.frozen,reason:freezeReason,
      });
      setMessage(warehouse.frozen?'Dégel enregistré.':'Stock agent gelé, autres agents non impactés.');
      setFreezeReason('');agents.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  if(props.preview)return <Panel title="Inventaires tournants">
    <Empty>Un contrôle bloque uniquement le stock de l’agent concerné.</Empty>
  </Panel>;
  return <div className="smtr-ref">
    {message&&<Notice tone="success">{message}</Notice>}
    {(error||agents.error||inventories.error)&&<Notice tone="error">{error||agents.error||inventories.error}</Notice>}
    <div className="catalog-metrics">
      <Metric label="STOCKS AGENTS" value={agents.data?.agents.length||0}/>
      <Metric label="STOCKS GELÉS" value={agents.data?.agents.filter(a=>a.frozen).length||0}/>
      <Metric label="INVENTAIRES EN COURS" value={inventories.data?.inventories.filter(i=>i.status==='IN_PROGRESS').length||0}/>
    </div>
    {!detailsSelected&&<>
    <Panel title={showStart?"Nouvel inventaire":"Stocks agents"} subtitle="Geler ou contrôler un stock précis sans interrompre les autres"
      action={<SmallButton kind="blue" onClick={()=>setShowStart(x=>!x)}><Boxes size={16}/> {showStart?"Retour à la liste":"+ Nouvel inventaire"}</SmallButton>}>
      {showStart&&<form className="catalog-form catalog-inner-panel" onSubmit={start}>
        <Field label="Stock agent à contrôler">
          <select required value={warehouseId} onChange={e=>setWarehouseId(e.target.value)}>
            <option value="">Sélectionner un agent</option>
            {agents.data?.agents.filter(x=>!x.frozen).map(a=>
              <option value={a.warehouseId} key={a.warehouseId}>{a.agentName} · {a.stockName}</option>)}
          </select>
        </Field>
        <p className="catalog-note">Au démarrage, ce stock seulement sera bloqué pour les ventes et les transferts. Les autres agents poursuivent leur activité.</p>
        <SubmitButton disabled={busy||!warehouseId||Boolean(chosen?.frozen)}>Démarrer l’inventaire</SubmitButton>
      </form>}
      {!showStart&&<>
      {agents.loading?<Loading/>:
        <DataTable headers={['AGENT','STOCK','STOCK ACTUEL','DERNIER INVENTAIRE','ÉTAT','ACTION']}
          rows={(agents.data?.agents||[]).map(a=>[
            a.agentName,a.stockName,a.currentCount,shortDate(a.lastInventory),
            <Status label={a.frozen?'Gelé':'Actif'}/>,
            <SmallButton onClick={()=>setWarehouseId(a.warehouseId)}>Sélectionner</SmallButton>,
          ])}/>}
      {chosen&&<div className="catalog-inner-panel" style={{marginTop:15}}>
        <div className="catalog-row"><strong>{chosen.agentName}</strong><Status label={chosen.frozen?'Gelé':'Actif'}/></div>
        <Field label="Motif du gel / dégel">
          <textarea value={freezeReason} rows={2} onChange={e=>setFreezeReason(e.target.value)}
            placeholder="Raison de contrôle ou autorisation de reprise"/>
        </Field>
        <div className="catalog-actions" style={{marginTop:10}}>
          <SmallButton kind={chosen.frozen?'blue':'danger'} disabled={busy||freezeReason.length<8}
            onClick={()=>toggleFreeze(chosen)}>
            <LockKeyhole size={16}/> {chosen.frozen?'Débloquer le stock':'Geler le stock'}
          </SmallButton>
        </div>
      </div>}
    </>}
    </Panel>
    {!showStart&&<>
    <Panel title="Historique des inventaires" subtitle="Comparaison stock initial vs réellement compté">
      {inventories.loading?<Loading/>:
        <DataTable headers={['N°','AGENT','DÉMARRAGE','ÉTAT','ACTION']}
          rows={(inventories.data?.inventories||[]).map(inv=>[
            '#'+inv.id,inv.agentName,shortDate(inv.openedAt),
            <Status label={inv.status==='CLOSED'?'Clôturé':'En cours'}/>,
            <SmallButton onClick={()=>{void loadDetail(inv.id);}}>Détails & comptage</SmallButton>,
          ])}/>}
    </Panel>
    </>}
    </>}
        {detailsSelected&&detail&&<Panel action={<SmallButton onClick={()=>{setSelected('');setDetail(null);}}>Retour à la liste</SmallButton>} title={'Inventaire #'+detail.id+' — '+detail.agentName}
      subtitle={detail.status==='IN_PROGRESS'?'Comptage en cours':'Résultats de l’inventaire clôturé'}>
      <form className="catalog-form" onSubmit={close}>
        {detail.lines.length===0&&<Empty>Aucun article actif ou gelé dans le stock au démarrage.</Empty>}
        <DataTable headers={['CATÉGORIE PRODUIT','ATTENDU','COMPTÉ','DIFFÉRENCE']}
          rows={detail.lines.map(l=>{
            const value=counts[l.productId]??String(l.expected);
            return [
              l.name,l.expected,
              detail.status==='IN_PROGRESS'?
                <input style={{maxWidth:95,minHeight:40}} type="number" min={0} required value={value}
                  onChange={e=>setCounts(s=>({...s,[l.productId]:e.target.value}))}/>:
                l.counted??'—',
              (Number(value)-l.expected)===0?'Conforme':
                <span className="catalog-negative">{Number(value)-l.expected}</span>,
            ];
          })}/>
      {detail.status==='IN_PROGRESS'&&<>
          <Field label="Note de clôture (facultative)">
            <textarea rows={2} value={note} maxLength={500} onChange={e=>setNote(e.target.value)}/>
          </Field>
          <div className="catalog-actions">
            <SmallButton onClick={()=>{setSelected('');setDetail(null);}}>Annuler</SmallButton>
            <SubmitButton disabled={busy||detail.lines.some(l=>counts[l.productId]==='')}>
              Clôturer le comptage</SubmitButton>
          </div>
        </>}
      </form>
        {detail.status==='CLOSED'&&detail.frozen&&
        detail.lines.some(l=>l.counted!==l.expected)&&!detail.reconciledAt&&
        <div className="catalog-inner-panel">
          <h3 className="catalog-section-title">Réconciliation physique des IMEI</h3>
          <div className="catalog-warning-box">
            Le stock est gelé après un écart. Cochez uniquement les IMEI physiquement présents
            pour chaque produit, en respectant exactement les quantités comptées.
            Tout IMEI non confirmé restera en quarantaine (HOLD) et ne pourra pas être vendu.
          </div>
          <form className="catalog-form" onSubmit={reconcile}>
            <div className="catalog-inline-list">
              {physicalItems.map(item=><label className="catalog-row" key={item.id}>
                <span><strong>{item.productName}</strong><br/><small>IMEI {item.imeiMasked} · {item.state}</small></span>
                <input type="checkbox" checked={verified.includes(item.id)}
                  onChange={()=>setVerified(v=>v.includes(item.id)?v.filter(x=>x!==item.id):[...v,item.id])}/>
              </label>)}
            </div>
            <Field label="Constat physique et explication">
              <textarea required minLength={8} maxLength={500} rows={3}
                value={reconcileReason} onChange={e=>setReconcileReason(e.target.value)}/>
            </Field>
            <SubmitButton disabled={busy||reconcileReason.length<8}>
              Réconcilier et maintenir les manquants gelés
            </SubmitButton>
          </form>
        </div>}
    </Panel>}
  </div>;
}
