import { useState, type FormEvent } from 'react';
import { DataTable, Empty, Field, Filters, Loading, Notice, Panel, SmallButton, SubmitButton, useRemote } from './CatalogueUI';
import { displayError, fcfa, patch } from './services';
import type { Role } from './permissions';

type Props={role:Role;token:string|null;preview:boolean;refresh:number;onLogout:()=>void;onRefresh:()=>void};
type Product={id:string;name:string;category:string;sku:string;minimumLevel:number;salePriceF:number|null};
type AgentLimit={id:string;name:string;creditLimitF:number;outstandingF:number};

export default function BusinessSettingsPage(props:Props){
  const director=props.role==='director';
  const products=useRemote<{products:Product[]}>(props.token,'/settings',props.refresh,props.onLogout);
  const agents=useRemote<{agents:AgentLimit[]}>(director?props.token:null,'/finance/agents',props.refresh,props.onLogout);
  const [selected,setSelected]=useState('');
  const [price,setPrice]=useState('');
  const [cost,setCost]=useState('');
  const [minimum,setMinimum]=useState('');
  const [agentId,setAgentId]=useState('');
  const [limit,setLimit]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const chosen=products.data?.products.find(p=>p.id===selected);
  const filtered=products.data?.products.filter(p=>
    (p.name+' '+p.sku+' '+p.category).toLowerCase().includes(query.toLowerCase()))||[];
  async function saveProduct(event:FormEvent){
    event.preventDefault();if(!props.token||busy||!selected)return;
    setBusy(true);setError('');setMessage('');
    try{
      await patch('/settings/products/'+selected,props.token,{
        salePriceF:Number(price),purchaseCostF:Number(cost),minimumLevel:Number(minimum),
      });
      setMessage('Prix de vente, coût d’achat et seuil de stock enregistrés.');
      products.reload();props.onRefresh();
      setSelected('');setPrice('');setCost('');setMinimum('');
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  async function updateLimit(event:FormEvent){
    event.preventDefault();if(!props.token||busy||!agentId)return;
    setBusy(true);setError('');setMessage('');
    try{
      await patch('/finance/agents/'+agentId+'/limit',props.token,{creditLimitF:Number(limit)});
      setMessage('Plafond de crédit de l’agent mis à jour.');
      agents.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  if(props.preview)return <Panel title="Paramètres produits">
    <Empty>La tarification est exclusivement réservée à la Direction.</Empty>
  </Panel>;
  return <div className="smtr-ref">
    {message&&<Notice tone="success">{message}</Notice>}
    {(error||products.error||agents.error)&&
      <Notice tone="error">{error||products.error||agents.error}</Notice>}
    <Panel title="Produits & tarification" subtitle="Prix, seuils d’alerte et références enregistrées">
      <Filters><Field label="Rechercher une référence">
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Produit, code ou catégorie"/>
      </Field></Filters>
      {products.loading?<Loading/>:<DataTable
        headers={['RÉFÉRENCE','CATÉGORIE','SEUIL MINI','PRIX DE VENTE','ACTION']}
        rows={filtered.map(p=>[
          <span><strong>{p.name}</strong><br/><small>{p.sku}</small></span>,
          p.category,p.minimumLevel,p.salePriceF===null?'Non défini':fcfa(p.salePriceF),
          director?<SmallButton onClick={()=>{
            setSelected(p.id);setPrice(String(p.salePriceF||''));setMinimum(String(p.minimumLevel));setCost('');
          }}>Modifier</SmallButton>:'Lecture',
        ])}/>}
      {director&&chosen&&<form className="catalog-form catalog-inner-panel" onSubmit={saveProduct}>
        <h3 className="catalog-card-title">Réglages de {chosen.name}</h3>
        <div className="catalog-form-row">
          <Field label="Prix de vente (FCFA)">
            <input type="number" min={1} required value={price} onChange={e=>setPrice(e.target.value)}/>
          </Field>
          <Field label="Coût d’achat (FCFA) — confidentiel">
            <input type="number" min={0} required value={cost} onChange={e=>setCost(e.target.value)}/>
          </Field>
          <Field label="Seuil minimum">
            <input type="number" min={0} required value={minimum} onChange={e=>setMinimum(e.target.value)}/>
          </Field>
        </div>
        <p className="catalog-note">Le coût d’achat n’est jamais renvoyé aux agents ou aux Managers. Renseigner un coût réel permet le calcul de marge en Direction.</p>
        <div className="catalog-actions">
          <SmallButton onClick={()=>setSelected('')}>Annuler</SmallButton>
          <SubmitButton disabled={busy}>Enregistrer les paramètres produit</SubmitButton>
        </div>
      </form>}
    </Panel>
    {director&&<Panel title="Plafonds de crédit des agents"
      subtitle="La Direction fixe les plafonds ; le Manager contrôle les clients">
      <DataTable headers={['AGENT','PLAFOND','CRÉANCES ACTIVES','ACTION']}
        rows={(agents.data?.agents||[]).map(a=>[
          a.name,fcfa(a.creditLimitF),fcfa(a.outstandingF),
          <SmallButton onClick={()=>{setAgentId(a.id);setLimit(String(a.creditLimitF));}}>Modifier</SmallButton>,
        ])}/>
      {agentId&&<form className="catalog-form catalog-inner-panel" onSubmit={updateLimit}>
        <h3 className="catalog-card-title">Modifier un plafond</h3>
        <Field label={'Plafond pour '+agents.data?.agents.find(a=>a.id===agentId)?.name}>
          <input required type="number" min={0} value={limit} onChange={e=>setLimit(e.target.value)}/>
        </Field>
        <SubmitButton disabled={busy}>Enregistrer le plafond</SubmitButton>
      </form>}
    </Panel>}
  </div>;
}
