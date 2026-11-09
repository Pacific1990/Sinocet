import {authenticatedFetch} from './posTransport';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeftRight, CheckCircle2, LoaderCircle, PackageSearch, Search } from 'lucide-react';
import {
  ApiError, listAgents, listCentralWarehouses, listPendingTransfers,
  listProducts, listStock, listStockItems, listTransfers, receiveStock,
  receiveTransfer, reportTransferDiscrepancy, startTransfer,
  type AgentDestination, type CentralWarehouse, type PendingTransfer,
  type StockCategory, type StockItem, type StockProduct, type TransferRecord,
} from './api';
import type { ModuleId, Role } from './permissions';
import { displayError, get, post } from './services';
import ImeiScanner from './ImeiScanner';

type Props = {
  screen: 'stocks' | 'transfers';
  role: Role;
  token: string | null;
  preview: boolean;
  onLogout: () => void;
  onNavigate: (module: ModuleId) => void;
};

function getError(error: unknown, onLogout: () => void): string {
  if (error instanceof ApiError && error.status === 401) {
    onLogout();
    return 'Votre session a expiré.';
  }
  return error instanceof Error ? error.message : 'Une erreur est survenue.';
}
function dateOf(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('fr-FR');
}
function Notice({message, tone = 'warning'}: {message: string; tone?: 'warning'|'success'|'error'}) {
  return <div className={'ref-notice ref-notice--'+tone} role={tone==='error'?'alert':'status'}>
    {tone==='success'?<CheckCircle2 size={18}/>:<AlertCircle size={18}/>}<span>{message}</span>
  </div>;
}
function Loading() {
  return <div className="ref-loading" role="status"><LoaderCircle size={19} className="spin"/> Chargement…</div>;
}
function RefEmpty({message}: {message:string}) {
  return <p className="ref-empty"><PackageSearch size={20}/>{message}</p>;
}

function CategoryTable({categories}: {categories:StockCategory[]}) {
  if (!categories.length) return <RefEmpty message="Aucun produit de stock disponible pour cet espace."/>;
  return <div className="ref-table-scroll"><table className="ref-table">
    <thead><tr><th>CATÉGORIE</th><th>QUANTITÉ DISPO.</th><th>SEUIL MINI</th><th>EMPLACEMENT</th><th>STATUT</th></tr></thead>
    <tbody>{categories.map(item=><tr key={item.id}>
      <td>{item.name}</td><td>{item.available}</td><td>{item.minimumLevel}</td>
      <td>{item.location}</td><td><span className={'ref-status '+(item.status==='Suffisant'?'ref-status--green':item.status==='Proche du seuil'?'ref-status--orange':'ref-status--red')}>{item.status}</span></td>
    </tr>)}</tbody>
  </table></div>;
}

function StockCentral({token,preview,onLogout,onNavigate}: Props) {
  const [categories,setCategories]=useState<StockCategory[]>([]);
  const [warehouses,setWarehouses]=useState<CentralWarehouse[]>([]);
  const [products,setProducts]=useState<StockProduct[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [reload,setReload]=useState(0);
  const [showReception,setShowReception]=useState(false);
  const [warehouseId,setWarehouseId]=useState('');
  const [productId,setProductId]=useState('');
  const [imeisText,setImeisText]=useState('');
  const [location,setLocation]=useState('');
  const [sending,setSending]=useState(false);
  const inputRef=useRef<HTMLInputElement|null>(null);
  const [importing,setImporting]=useState(false);
  const [showProduct,setShowProduct]=useState(false);
  const [productName,setProductName]=useState('');
  const [productCategory,setProductCategory]=useState('');
  const [sku,setSku]=useState('');
  const [minimumLevel,setMinimumLevel]=useState('');

  async function importExcel(file:File){
    if(!token||importing||!warehouseId)return;
    if(!/\.xlsx$/i.test(file.name)||file.size>2*1024*1024){
      setError('Sélectionnez un fichier .xlsx de moins de 2 Mo.');return;
    }
    if(!window.confirm('Importer ce lot Excel dans le stock central sélectionné ?')){
      if(inputRef.current)inputRef.current.value='';return;
    }
    setImporting(true);setError('');setNotice('');
    try{
      const form=new FormData();form.set('warehouseId',warehouseId);form.set('file',file);
      const response=await authenticatedFetch('/stocks/import',token,{
        method:'POST',headers:{Authorization:'Bearer '+token},body:form,credentials:'omit',cache:'no-store',
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.message||'Import Excel impossible.');
      setNotice(data.import.quantity+' IMEI importés. '+data.import.skuCount+' référence(s) concernée(s).');
      setReload(x=>x+1);
    }catch(e){setError(displayError(e,onLogout));}
    finally{setImporting(false);if(inputRef.current)inputRef.current.value='';}
  }
  async function createProduct(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!token||sending)return;
    setSending(true);setError('');setNotice('');
    try{
      await post('/stocks/products',token,{
        name:productName,category:productCategory,sku,minimumLevel:Number(minimumLevel||0),
      });
      setNotice('Référence produit enregistrée.');
      setProductName('');setProductCategory('');setSku('');setMinimumLevel('');
      setShowProduct(false);setReload(x=>x+1);
    }catch(e){setError(displayError(e,onLogout));}finally{setSending(false);}
  }

  useEffect(()=>{
    if (!token) return;
    let alive=true;
    setLoading(true);setError('');
    Promise.all([listStock(token),listCentralWarehouses(token),listProducts(token)])
      .then(([stock,central,productList])=>{
        if(!alive)return;
        setCategories(stock.categories);
        setWarehouses(central.warehouses);
        setProducts(productList.products);
        setWarehouseId(current=>current || central.warehouses[0]?.id || '');
        setProductId(current=>current || productList.products[0]?.id || '');
      })
      .catch(e=>{if(alive)setError(getError(e,onLogout));})
      .finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[token,reload,onLogout]);

  async function saveLot(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); if (!token || sending) return;
    const entries=imeisText.split(/[\r\n,;]+/).map(x=>x.trim()).filter(Boolean);
    if (!entries.length || entries.length>100 || entries.some(imei=>!/^\d{15,16}$/.test(imei))){
      setError('Saisissez de 1 à 100 IMEI à 15 ou 16 chiffres, un par ligne.'); return;
    }
    setSending(true);setError('');setNotice('');
    try{
      const result=await receiveStock(token,{warehouseId,productId,items:entries.map(imei=>({imei,location}))});
      setNotice(result.quantity+' exemplaire(s) enregistré(s) dans le stock central.');
      setImeisText('');setShowReception(false);setReload(x=>x+1);
    }catch(e){setError(getError(e,onLogout));}finally{setSending(false);}
  }
  return <div className="smtr-ref">
    <section className="ref-panel ref-panel--stock">
      <div className="ref-panel-head">
        <div><h2>Stock Central{warehouses.length===1?' — '+warehouses[0].name:''}</h2>
          <p>Consultation et réception des arrivages fournisseurs</p></div>
        <div className="ref-actions">
          <button type="button" className="ref-button ref-button--outline"
            disabled={preview||importing||!warehouseId} onClick={()=>inputRef.current?.click()}>
            {importing?'Import en cours…':'Importer Excel'}
          </button>
          <input type="file" ref={inputRef} style={{display:'none'}} accept=".xlsx" aria-label="Choisir un fichier Excel"
            onChange={e=>{const file=e.target.files?.[0];if(file)void importExcel(file);}}/>
          <button type="button" className="ref-button ref-button--outline" disabled={preview}
            onClick={()=>setShowProduct(v=>!v)}>+ Référence produit</button>
          <button type="button" className="ref-button ref-button--blue" disabled={preview}
            onClick={()=>{setShowReception(x=>!x);setNotice('');}}>+ Réceptionner un lot</button>
        </div>
      </div>
      {notice&&<Notice message={notice} tone="success"/>}
      {error&&<Notice message={error} tone="error"/>}
      <p className="catalog-note">Import Excel : colonnes SKU, IMEI (texte) et EMPLACEMENT (facultative). 500 lignes et 2 Mo maximum.</p>
      {showProduct&&!preview&&<form className="ref-form ref-reception" onSubmit={createProduct}>
        <h3>Nouvelle référence produit</h3>
        <div className="ref-fields">
          <label>Nom du produit<input required minLength={2} maxLength={180} value={productName} onChange={e=>setProductName(e.target.value)}/></label>
          <label>Catégorie<input required minLength={2} maxLength={120} value={productCategory} onChange={e=>setProductCategory(e.target.value)}/></label>
          <label>SKU (référence unique)<input required minLength={2} maxLength={80} value={sku} onChange={e=>setSku(e.target.value)}/></label>
          <label>Seuil mini<input required type="number" min={0} max={100000} value={minimumLevel} onChange={e=>setMinimumLevel(e.target.value)}/></label>
        </div>
        <div className="ref-form-actions">
          <button className="ref-button ref-button--outline" type="button" onClick={()=>setShowProduct(false)}>Annuler</button>
          <button className="ref-button ref-button--blue" type="submit" disabled={sending}>Enregistrer la référence</button>
        </div>
      </form>}
      {showReception&&!preview&&<form className="ref-form ref-reception" onSubmit={saveLot}>
        <h3>Réceptionner un lot — stock central</h3>
        <div className="ref-fields">
          <label>Entrepôt central
            <select value={warehouseId} onChange={e=>setWarehouseId(e.target.value)} required>
              <option value="">Choisir un dépôt</option>
              {warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label>Référence produit
            <select value={productId} onChange={e=>setProductId(e.target.value)} required>
              <option value="">Choisir un produit</option>
              {products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}
            </select>
          </label>
          <label>Emplacement
            <input value={location} onChange={e=>setLocation(e.target.value)} maxLength={100} placeholder="Rayon / zone"/>
          </label>
        </div>
        <label>IMEI du lot — un par ligne
          <textarea rows={4} value={imeisText} onChange={e=>setImeisText(e.target.value)}
            placeholder="Saisir les IMEI réellement réceptionnés" required/>
        </label>
        {!products.length&&<Notice message="Aucune référence produit active. Un manager doit créer les références via l’API avant réception."/>}
        <div className="ref-form-actions">
          <button type="button" className="ref-button ref-button--outline" onClick={()=>setShowReception(false)}>Annuler</button>
          <button type="submit" className="ref-button ref-button--blue" disabled={sending||!products.length||!warehouses.length}>
            {sending?'Enregistrement…':'Enregistrer le lot'}</button>
        </div>
      </form>}
      <div className="ref-categories">
        {categories.map(category=><span key={category.id} className="ref-category">{category.name}</span>)}
      </div>
      {loading?<Loading/>:<CategoryTable categories={categories}/>}
      <p className="ref-footnote">Note — « Ramba » n’apparaît jamais ici : ce n’est pas une catégorie d’achat, uniquement une résolution SAV.</p>
    </section>
    <div className="ref-footer-action"><button type="button" className="ref-button ref-button--outline"
      onClick={()=>onNavigate('transfers')}>Ouvrir les transferts Central → Agent</button></div>
  </div>;
}

function AgentStock({token,preview,onLogout,onNavigate}:Props) {
  const [categories,setCategories]=useState<StockCategory[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!token)return;
    let mounted=true;setLoading(true);
    listStock(token).then(x=>{if(mounted)setCategories(x.categories);})
      .catch(e=>{if(mounted)setError(getError(e,onLogout));})
      .finally(()=>{if(mounted)setLoading(false);});
    return()=>{mounted=false;};
  },[token,onLogout]);
  return <div className="smtr-ref ref-agent-layout">
    <section className="ref-panel"><div className="ref-panel-head">
      <div><h2>Mon stock</h2><p>Uniquement les exemplaires attribués à votre compte</p></div>
    </div>
      {error&&<Notice message={error} tone="error"/>}
      {loading?<Loading/>:<CategoryTable categories={categories}/>}
      {preview&&<p className="ref-footnote">Aperçu sans données de stock.</p>}
    </section>
    <button type="button" className="ref-button ref-button--blue ref-button--full" onClick={()=>onNavigate('transfers')}>
      Valider une réception <ArrowLeftRight size={17}/>
    </button>
  </div>;
}

function ManagerTransfers({token,preview,onLogout}:Props) {
  const [warehouses,setWarehouses]=useState<CentralWarehouse[]>([]);
  const [agents,setAgents]=useState<AgentDestination[]>([]);
  const [transfers,setTransfers]=useState<TransferRecord[]>([]);
  const [warehouseId,setWarehouseId]=useState('');
  const [agentId,setAgentId]=useState('');
  const [items,setItems]=useState<StockItem[]>([]);
  const [selected,setSelected]=useState<string[]>([]);
  const [query,setQuery]=useState('');
  const [loading,setLoading]=useState(false);
  const [loadingItems,setLoadingItems]=useState(false);
  const [sending,setSending]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [reload,setReload]=useState(0);
  const requestId=useRef(crypto.randomUUID());
  const [reconcileId,setReconcileId]=useState('');
  const [reconcileItems,setReconcileItems]=useState<Array<{id:string;imeiMasked:string;productName:string}>>([]);
  const [returned,setReturned]=useState<string[]>([]);
  const [reconcileReason,setReconcileReason]=useState('');

  async function openReconciliation(id:string){
    if(!token)return;
    setError('');setReturned([]);setReconcileItems([]);setReconcileId(id);setReconcileReason('');
    try{
      const result=await get<{transfer:{items:Array<{id:string;imeiMasked:string;productName:string}>}}>('/transfers/'+id,token);
      setReconcileItems(result.transfer.items);
    }catch(e){setError(getError(e,onLogout));}
  }
  async function reconcile(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!token||sending||!reconcileId)return;
    if(!window.confirm('Confirmez-vous avoir revérifié physiquement ces IMEI au Central ? Les appareils manquants resteront gelés.'))return;
    setSending(true);setError('');setNotice('');
    try{
      const result=await post<{transfer:{id:string;status:string;returnedCount:number;missingCount:number}}>(
        '/transfers/'+reconcileId+'/resolve',token,
        {verifiedItemIds:returned,reason:reconcileReason}
      );
      setNotice('Écart traité : '+result.transfer.returnedCount+' IMEI vérifiés retournés au Central, '+
        result.transfer.missingCount+' manquant(s) maintenus en HOLD.');
      setReconcileId('');setReturned([]);setReconcileItems([]);setReconcileReason('');
      setReload(x=>x+1);
    }catch(e){setError(getError(e,onLogout));}
    finally{setSending(false);}
  }

  useEffect(()=>{
    if(!token)return;
    let active=true;setLoading(true);setError('');
    Promise.all([listCentralWarehouses(token),listAgents(token),listTransfers(token)])
      .then(([wh,ag,tr])=>{
        if(!active)return;
        setWarehouses(wh.warehouses);setAgents(ag.agents);setTransfers(tr.transfers);
        setWarehouseId(current=>current||wh.warehouses[0]?.id||'');
        setAgentId(current=>current||ag.agents[0]?.id||'');
      }).catch(e=>{if(active)setError(getError(e,onLogout));})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[token,reload,onLogout]);

  useEffect(()=>{
    if(!token||!warehouseId){setItems([]);return;}
    let active=true;setLoadingItems(true);
    const timer=window.setTimeout(()=>{
      listStockItems(token,warehouseId,query)
        .then(r=>{if(active)setItems(r.items);})
        .catch(e=>{if(active)setError(getError(e,onLogout));})
        .finally(()=>{if(active)setLoadingItems(false);});
    },250);
    return()=>{active=false;window.clearTimeout(timer);};
  },[token,warehouseId,query,reload,onLogout]);

  function toggleItem(id:string) {
    requestId.current=crypto.randomUUID();
    setSelected(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id]);
  }
  async function send(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!token||sending)return;
    if(!selected.length){setError('Sélectionnez au moins un IMEI disponible.');return;}
    setSending(true);setError('');setNotice('');
    try {
      const result=await startTransfer(token,{requestId:requestId.current,
        sourceWarehouseId:warehouseId,agentId,itemIds:selected});
      setNotice('Transfert #'+result.transfer.id+' envoyé : état En transit. Réception agent requise.');
      requestId.current=crypto.randomUUID();setSelected([]);setReload(x=>x+1);
    }catch(e){setError(getError(e,onLogout));}finally{setSending(false);}
  }
  const agentName=agents.find(agent=>agent.id===agentId)?.name||'—';
  return <div className="smtr-ref">
    {notice&&<Notice message={notice} tone="success"/>}
    {error&&<Notice message={error} tone="error"/>}
    <form className="ref-transfer-layout" onSubmit={send}>
      <section className="ref-panel ref-transfer-select">
        <div className="ref-panel-head"><div><h2>Nouveau transfert</h2><p>Étape 1/2 — sélection des produits</p></div></div>
        <div className="ref-fields ref-fields--transfer">
          <label>Stock Central
            <select value={warehouseId} onChange={e=>{
              requestId.current=crypto.randomUUID();setWarehouseId(e.target.value);setSelected([]);
            }} disabled={preview} required>
              <option value="">Choisir un dépôt</option>
              {warehouses.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label>Agent destinataire
            <select value={agentId} onChange={e=>{requestId.current=crypto.randomUUID();setAgentId(e.target.value);}}
              disabled={preview} required>
              <option value="">Choisir un agent</option>
              {agents.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label>Recherche IMEI / produit
            <span className="ref-search"><Search size={17}/>
              <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Scanner ou saisir…" disabled={preview}/>
            </span>
          </label>
        </div>
        <div className="catalog-actions" style={{marginBottom:14}}>
          <ImeiScanner onScan={setQuery} disabled={preview||sending}/>
        </div>
        {loading||loadingItems?<Loading/>:
          !items.length?<RefEmpty message="Aucun IMEI disponible dans ce stock central."/>:
          <div className="ref-table-scroll"><table className="ref-table ref-table--selection">
            <thead><tr><th aria-label="Choisir"/><th>IMEI</th><th>PRODUIT</th><th>EMPLACEMENT</th></tr></thead>
            <tbody>{items.map(item=><tr key={item.id}>
              <td><input type="checkbox" aria-label={'Sélectionner '+item.imeiMasked} checked={selected.includes(item.id)}
                onChange={()=>toggleItem(item.id)} disabled={preview||sending}/></td>
              <td className="ref-monospace">{item.imeiMasked}</td>
              <td>{item.productName}</td><td>{item.location}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>
      <section className="ref-panel ref-transfer-summary">
        <div className="ref-panel-head"><h2>Résumé du transfert</h2></div>
        <dl><dt>Destinataire</dt><dd>{agentName}</dd>
          <dt>Articles sélectionnés</dt><dd>{selected.length}</dd>
          <dt>Stock central</dt><dd>réservé à l’envoi</dd></dl>
        <p>Le statut passe à <strong>En Transit</strong> dès l’envoi. L’agent doit valider la réception avant que les produits n’intègrent son stock actif.</p>
        <button type="submit" className="ref-button ref-button--blue ref-button--full"
          disabled={preview||sending||!selected.length||!warehouseId||!agentId}>
          {sending?'Envoi…':'Envoyer le transfert'}</button>
        <button type="button" className="ref-button ref-button--outline ref-button--full"
          onClick={()=>{setSelected([]);setQuery('');requestId.current=crypto.randomUUID();}}>Annuler</button>
      </section>
    </form>
    <section className="ref-panel ref-history"><h2>Transferts en cours</h2>
      {!transfers.length?<RefEmpty message="Aucun transfert enregistré."/>:
      <div className="ref-table-scroll"><table className="ref-table"><thead><tr>
        <th>N°</th><th>DESTINATAIRE</th><th>QUANTITÉ</th><th>INITIÉ LE</th><th>STATUT</th><th>ACTION</th>
      </tr></thead><tbody>{transfers.map(tr=><tr key={tr.id}><td>#{tr.id}</td>
        <td>{tr.agentName}</td><td>{tr.quantity}</td><td>{dateOf(tr.sentAt)}</td>
        <td><span className={'ref-status '+(tr.status==='RECEIVED'?'ref-status--green':'ref-status--orange')}>
          {tr.status==='IN_TRANSIT'?'En transit':tr.status==='RECEIVED'?'Reçu':'Écart signalé'}
        </span></td>
        <td>{tr.status==='DISCREPANCY'?
          <button type="button" className="ref-button ref-button--outline"
            onClick={()=>{void openReconciliation(tr.id);}}>Réconcilier</button>:
          '—'}</td>
      </tr>)}</tbody></table></div>}
    </section>
    {reconcileId&&<section className="ref-panel" style={{marginTop:16}}>
      <div className="ref-panel-head">
        <div><h2>Réconciliation transfert #{reconcileId}</h2>
          <p>Retour physique au Central après signalement de l’Agent</p>
        </div>
      </div>
      <div className="catalog-warning-box">
        Cochez uniquement les IMEI physiquement revérifiés au Central. Les autres IMEI resteront gelés et feront l’objet d’une enquête.
      </div>
      <form className="catalog-form" onSubmit={reconcile}>
        <div className="catalog-inline-list">
          {reconcileItems.map(item=><label className="catalog-row" key={item.id}>
            <span><strong>{item.productName}</strong><br/><small>IMEI {item.imeiMasked}</small></span>
            <input type="checkbox" checked={returned.includes(item.id)}
              onChange={()=>setReturned(v=>v.includes(item.id)?v.filter(x=>x!==item.id):[...v,item.id])}/>
          </label>)}
        </div>
        <label className="catalog-field">Constat et décision du Manager
          <textarea required minLength={8} maxLength={500} rows={3}
            value={reconcileReason} onChange={e=>setReconcileReason(e.target.value)}/>
        </label>
        <div className="catalog-actions">
          <button className="ref-button ref-button--outline" type="button" onClick={()=>setReconcileId('')}>Annuler</button>
          <button className="ref-button ref-button--blue" type="submit" disabled={sending||reconcileReason.length<8}>
            Enregistrer la réconciliation</button>
        </div>
      </form>
    </section>}
  </div>;
}

function AgentReception({token,preview,onLogout}:Props) {
  const [pending,setPending]=useState<PendingTransfer[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [checked,setChecked]=useState<string[]>([]);
  const [reason,setReason]=useState('');
  const [showDiscrepancy,setShowDiscrepancy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [sending,setSending]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [reload,setReload]=useState(0);
  useEffect(()=>{
    if(!token)return;
    let mounted=true;setLoading(true);setError('');
    listPendingTransfers(token).then(r=>{
      if(!mounted)return;
      setPending(r.transfers);
      setSelectedId(current=>r.transfers.some(x=>x.id===current)?current:r.transfers[0]?.id||'');
    }).catch(e=>{if(mounted)setError(getError(e,onLogout));})
      .finally(()=>{if(mounted)setLoading(false);});
    return()=>{mounted=false;};
  },[token,reload,onLogout]);
  const transfer=pending.find(x=>x.id===selectedId);
  function selectTransfer(id:string){setSelectedId(id);setChecked([]);setReason('');setShowDiscrepancy(false);}
  async function confirm() {
    if(!token||!transfer||sending)return;
    setSending(true);setError('');setNotice('');
    try{
      const result=await receiveTransfer(token,transfer.id,checked);
      setNotice('Réception du transfert #'+result.transfer.id+' validée. Stock agent mis à jour.');
      setChecked([]);setReload(x=>x+1);
    }catch(e){setError(getError(e,onLogout));}finally{setSending(false);}
  }
  async function report(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!token||!transfer||sending)return;
    setSending(true);setError('');setNotice('');
    try{
      const result=await reportTransferDiscrepancy(token,transfer.id,checked,reason);
      setNotice('Écart signalé sur le transfert #'+result.transfer.id+'. Articles gelés : examen Manager requis.');
      setChecked([]);setReason('');setShowDiscrepancy(false);setReload(x=>x+1);
    }catch(e){setError(getError(e,onLogout));}finally{setSending(false);}
  }
  return <div className="smtr-ref ref-agent-layout">
    {notice&&<Notice message={notice} tone="success"/>}
    {error&&<Notice message={error} tone="error"/>}
    <section className="ref-receive-frame">
      {loading?<Loading/>: !transfer?
        <RefEmpty message="Aucun transfert en attente de validation de réception."/>:
        <>
          {pending.length>1&&<label className="ref-agent-switch">Transfert entrant
            <select value={selectedId} onChange={e=>selectTransfer(e.target.value)}>
              {pending.map(item=><option key={item.id} value={item.id}>Transfert #{item.id} · {dateOf(item.sentAt)}</option>)}
            </select>
          </label>}
          <div className="ref-incoming-banner"><strong>Transfert entrant — Stock Central</strong>
            <span>Envoyé le {dateOf(transfer.sentAt)} · {transfer.source}</span></div>
          <div className="ref-incoming-card"><h2>Articles attendus ({transfer.items.length})</h2>
            <p className="ref-helper">Cochez chaque IMEI uniquement après vérification physique.</p>
            {transfer.items.map(item=><label className="ref-expected" key={item.id}>
              <span className="ref-monospace">{item.imeiMasked}</span>
              <span>{item.productName}</span>
              <input type="checkbox" checked={checked.includes(item.id)} disabled={preview||sending}
                onChange={()=>setChecked(current=>current.includes(item.id)
                  ?current.filter(x=>x!==item.id):[...current,item.id])}/>
            </label>)}
          </div>
          <button type="button" className="ref-button ref-button--blue ref-button--full"
            disabled={preview||sending||checked.length!==transfer.items.length} onClick={confirm}>
            {sending?'Validation…':'Valider la réception'}
          </button>
          <button type="button" className="ref-button ref-button--outlined-blue ref-button--full"
            disabled={preview||sending} onClick={()=>setShowDiscrepancy(x=>!x)}>Signaler un écart</button>
          {showDiscrepancy&&<form className="ref-incoming-card ref-discrepancy" onSubmit={report}>
            <p>Les IMEI non cochés seront signalés comme manquants. Tous les articles concernés seront gelés jusqu’à contrôle du Manager.</p>
            <label>Motif précis de l’écart
              <textarea required minLength={8} maxLength={500} rows={3} value={reason}
                onChange={e=>setReason(e.target.value)} placeholder="Expliquer la différence constatée"/>
            </label>
            <button className="ref-button ref-button--outlined-blue ref-button--full" type="submit"
              disabled={sending||checked.length===transfer.items.length||reason.trim().length<8}>
              Confirmer le signalement
            </button>
          </form>}
        </>
      }
      <p className="ref-agent-footnote">La validation engage votre responsabilité. Un écart bloque le transfert et nécessite un examen Manager.</p>
    </section>
  </div>;
}

export default function Operations(props:Props){
  if(props.screen==='stocks'){
    return props.role==='agent'?<AgentStock {...props}/>:<StockCentral {...props}/>;
  }
  return props.role==='agent'?<AgentReception {...props}/>:<ManagerTransfers {...props}/>;
}
