import { useState, type FormEvent } from 'react';
import { DataTable, Field, Filters, Loading, Notice, Panel, SmallButton, Status, SubmitButton, useRemote } from './CatalogueUI';
import { displayError, fcfa, patch, post } from './services';
import { downloadExcelTemplate, uploadExcel, type ImportPreview } from './importExcel';
import type { Role } from './permissions';

type Product={
  id:string; productId:string; sku:string; name:string; category:string;
  description:string; brand:string|null; modelName:string|null; variantName:string|null;
  color:string|null; storageGb:number|null; ramGb:number|null; warrantyMonths:number|null;
  trackingMode:string; minimumLevel:number; salePriceF:number|null; available:number|null; active:boolean;
};
type Draft={
  sku:string;name:string;category:string;description:string;brand:string;modelName:string;
  variantName:string;color:string;storageGb:string;ramGb:string;warrantyMonths:string;
  trackingMode:string;minimumLevel:string;salePriceF:string;purchaseCostF:string;
};
type Props={token:string|null;role:Role;preview:boolean;refresh:number;onLogout:()=>void;onRefresh:()=>void};
const emptyDraft:Draft={
  sku:'',name:'',category:'',description:'',brand:'',modelName:'',variantName:'',
  color:'',storageGb:'',ramGb:'',warrantyMonths:'',trackingMode:'individual',
  minimumLevel:'0',salePriceF:'',purchaseCostF:'',
};
function fromProduct(p:Product):Draft{
  return {
    sku:p.sku,name:p.name,category:p.category,description:p.description||'',
    brand:p.brand||'',modelName:p.modelName||'',variantName:p.variantName||'',
    color:p.color||'',storageGb:p.storageGb==null?'':String(p.storageGb),
    ramGb:p.ramGb==null?'':String(p.ramGb),
    warrantyMonths:p.warrantyMonths==null?'':String(p.warrantyMonths),
    trackingMode:p.trackingMode,minimumLevel:String(p.minimumLevel),
    salePriceF:'',purchaseCostF:'',
  };
}
export default function ProductsPage(props:Props){
  const data=useRemote<{products:Product[]}>(props.token,'/catalog/products',props.refresh,props.onLogout);
  const products=data.data?.products||[];
  const canManage=props.role==='manager'||props.role==='director';
  const director=props.role==='director';
  const [view,setView]=useState<'list'|'form'|'detail'|'import'>('list');
  const [selected,setSelected]=useState('');
  const [form,setForm]=useState<Draft>(emptyDraft);
  const [query,setQuery]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [result,setResult]=useState<ImportPreview|null>(null);
  const chosen=products.find(x=>x.id===selected);
  const filtered=products.filter(p=>
    (p.name+' '+p.sku+' '+p.category+' '+(p.brand||'')+' '+(p.modelName||''))
      .toLowerCase().includes(query.toLowerCase()));
  function back(){setView('list');setError('');setFile(null);setResult(null);}
  function create(){setSelected('');setForm({...emptyDraft});setError('');setView('form');}
  function edit(p:Product){setSelected(p.id);setForm(fromProduct(p));setError('');setView('form');}
  function setField(key:keyof Draft,value:string){setForm(old=>({...old,[key]:value}));}
  async function save(event:FormEvent){
    event.preventDefault();if(!props.token||busy||!canManage)return;
    setBusy(true);setError('');setNotice('');
    try{
      if(selected)await patch('/catalog/products/'+selected,props.token,form);
      else await post('/catalog/products',props.token,form);
      setNotice(selected?'Produit mis à jour.':'Produit créé.');
      back();data.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  async function toggle(p:Product){
    if(!props.token||busy||!canManage)return;
    if(!window.confirm((p.active?'Désactiver':'Réactiver')+' '+p.name+' ?'))return;
    setBusy(true);setError('');setNotice('');
    try{
      await patch('/catalog/products/'+p.id+'/status',props.token,{active:!p.active});
      setNotice('Statut produit mis à jour.');data.reload();props.onRefresh();setView('list');
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  async function download(){
    if(!props.token)return;
    setBusy(true);setError('');
    try{await downloadExcelTemplate(props.token);}
    catch(e){setError(displayError(e,props.onLogout));}
    finally{setBusy(false);}
  }
  async function previewFile(next:File){
    if(!props.token)return;
    setFile(next);setResult(null);setError('');setBusy(true);
    try{
      const response=await uploadExcel(props.token,'/catalog/import/preview',next);
      setResult(response.preview||null);
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  async function submitImport(){
    if(!props.token||!file||!result?.canImport||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const response=await uploadExcel(props.token,'/catalog/import',file);
      setNotice((response.import?.quantity||0)+' produits importés.');
      back();data.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  const heading=view==='list'?'Catalogue Produits':view==='form'
    ?(selected?'Modifier le produit':'Nouveau produit'):view==='detail'?'Fiche produit':'Importer des produits';
  const backAction=view==='list'?undefined:<SmallButton onClick={back}>Retour aux produits</SmallButton>;
  if(props.preview)return <Panel title="Produits"><p className="catalog-note">Aperçu sans données. Aucune création possible.</p></Panel>;
  return <div className="smtr-ref product-catalog">
    {notice&&<Notice tone="success">{notice}</Notice>}
    {(error||data.error)&&<Notice tone="error">{error||data.error}</Notice>}
    {view==='list'&&<Panel title={heading} subtitle="Références, caractéristiques, variantes et disponibilité"
      action={<>
        {canManage&&<SmallButton onClick={()=>{setError('');setFile(null);setResult(null);setView('import');}}>Importer Excel</SmallButton>}
        {canManage&&<SmallButton onClick={create} kind="blue">+ Nouveau produit</SmallButton>}
      </>}>
      <Filters><Field label="Rechercher une référence"><input value={query}
        onChange={e=>setQuery(e.target.value)} placeholder="Nom, SKU, modèle ou marque"/></Field></Filters>
      {data.loading?<Loading/>:<DataTable
        headers={['PRODUIT','SKU','CATÉGORIE','SUIVI','DISPONIBLE','PRIX VENTE','STATUT','ACTIONS']}
        rows={filtered.map(p=>[
          <span><strong>{p.name}</strong><br/><small>{[p.brand,p.modelName,p.variantName].filter(Boolean).join(' · ')}</small></span>,
          p.sku,p.category,p.trackingMode==='standard'?'Quantité':'IMEI',
          p.available==null?'—':p.available,
          p.salePriceF==null?'Non renseigné':fcfa(p.salePriceF),
          <Status label={p.active?'Actif':'Inactif'} type={p.active?'green':'red'}/>,
          <div className="ref-actions">
            <SmallButton onClick={()=>{setSelected(p.id);setView('detail');}}>Fiche</SmallButton>
            {canManage&&<SmallButton onClick={()=>edit(p)}>Modifier</SmallButton>}
          </div>,
        ])} emptyMessage="Aucun produit. Créez votre première référence."/>}
      <p className="ref-footnote">Chaque SKU représente une variante vendable ; les unités sont réceptionnées séparément dans Stocks.</p>
    </Panel>}
    {view==='detail'&&<Panel title={chosen?.name||heading} subtitle={chosen?.sku||''}
      action={backAction}>
      {chosen&&<div className="product-details">
        {[
          ['Catégorie',chosen.category],['Marque',chosen.brand],['Modèle',chosen.modelName],
          ['Variante',chosen.variantName],['Couleur',chosen.color],
          ['Stockage',chosen.storageGb==null?'':chosen.storageGb+' Go'],
          ['RAM',chosen.ramGb==null?'':chosen.ramGb+' Go'],
          ['Garantie',chosen.warrantyMonths==null?'':chosen.warrantyMonths+' mois'],
          ['Suivi',chosen.trackingMode==='standard'?'Par quantité':'Par IMEI'],
          ['Seuil mini',String(chosen.minimumLevel)],
          ['Stock disponible',chosen.available==null?'Non accessible':String(chosen.available)],
          ['Prix de vente',chosen.salePriceF==null?'Non défini':fcfa(chosen.salePriceF)],
          ['Description',chosen.description],
        ].map(([label,value])=><div key={label}><small>{label}</small><strong>{value||'—'}</strong></div>)}
      </div>}
      {chosen&&canManage&&<div className="ref-form-actions">
        <SmallButton onClick={()=>edit(chosen)}>Modifier la fiche</SmallButton>
        <SmallButton kind={chosen.active?'danger':'blue'} onClick={()=>void toggle(chosen)}
          disabled={busy}>{chosen.active?'Désactiver':'Réactiver'}</SmallButton>
      </div>}
    </Panel>}
    {view==='form'&&<Panel title={heading} subtitle="Une variante par SKU, fiche indépendante du stock" action={backAction}>
      <form className="catalog-form product-form" onSubmit={save}>
        <div className="product-form-grid">
          <Field label="SKU unique *"><input required minLength={2} maxLength={100}
            value={form.sku} onChange={e=>setField('sku',e.target.value)}/></Field>
          <Field label="Nom du produit *"><input required minLength={2} maxLength={255}
            value={form.name} onChange={e=>setField('name',e.target.value)}/></Field>
          <Field label="Catégorie *"><input required minLength={2} maxLength={100}
            value={form.category} onChange={e=>setField('category',e.target.value)}/></Field>
          <Field label="Marque"><input value={form.brand} onChange={e=>setField('brand',e.target.value)}/></Field>
          <Field label="Modèle"><input value={form.modelName} onChange={e=>setField('modelName',e.target.value)}/></Field>
          <Field label="Variante"><input value={form.variantName} onChange={e=>setField('variantName',e.target.value)}/></Field>
          <Field label="Couleur"><input value={form.color} onChange={e=>setField('color',e.target.value)}/></Field>
          <Field label="Stockage (Go)"><input type="number" min={0} value={form.storageGb}
            onChange={e=>setField('storageGb',e.target.value)}/></Field>
          <Field label="RAM (Go)"><input type="number" min={0} value={form.ramGb}
            onChange={e=>setField('ramGb',e.target.value)}/></Field>
          <Field label="Garantie (mois)"><input type="number" min={0} max={240} value={form.warrantyMonths}
            onChange={e=>setField('warrantyMonths',e.target.value)}/></Field>
          <Field label="Traçabilité *"><select value={form.trackingMode}
            onChange={e=>setField('trackingMode',e.target.value)}>
            <option value="individual">IMEI / appareil individuel</option>
            <option value="standard">Quantité / accessoire</option>
          </select></Field>
          <Field label="Seuil minimum"><input type="number" min={0} required value={form.minimumLevel}
            onChange={e=>setField('minimumLevel',e.target.value)}/></Field>
          {director&&<>
            <Field label="Prix de vente (FCFA)"><input type="number" min={1} value={form.salePriceF}
              placeholder={selected?'Laisser vide pour conserver':'Facultatif'}
              onChange={e=>setField('salePriceF',e.target.value)}/></Field>
            <Field label="Coût d'achat (FCFA) — confidentiel"><input type="number" min={0}
              value={form.purchaseCostF} placeholder={selected?'Laisser vide pour conserver':'Facultatif'}
              onChange={e=>setField('purchaseCostF',e.target.value)}/></Field>
          </>}
        </div>
        <Field label="Description"><textarea rows={3} maxLength={1000} value={form.description}
          onChange={e=>setField('description',e.target.value)}/></Field>
        {selected&&<p className="catalog-note">Un changement de suivi IMEI/quantité est bloqué si des unités ont déjà été réceptionnées.</p>}
        <div className="ref-form-actions"><SmallButton onClick={back}>Annuler</SmallButton>
          <SubmitButton disabled={busy}>{busy?'Enregistrement…':'Enregistrer le produit'}</SubmitButton>
        </div>
      </form>
    </Panel>}
    {view==='import'&&<Panel title={heading} subtitle="Aperçu obligatoire avant toute création ou modification" action={backAction}>
      <p className="catalog-note">Remplissez la feuille PRODUITS. La colonne ACTION doit contenir CREER ou MODIFIER : aucun SKU n'est remplacé automatiquement. Les prix sont réservés à la Direction.</p>
      <div className="ref-actions product-import-tools">
        <SmallButton onClick={()=>void download()} disabled={busy}>Télécharger le modèle Excel</SmallButton>
        <label className="product-file-label">Choisir un fichier .xlsx
          <input aria-label="Fichier Excel des produits" type="file" accept=".xlsx"
            disabled={busy} onChange={e=>{const next=e.target.files?.[0];if(next)void previewFile(next);}}/>
        </label>
      </div>
      {busy&&<Loading/>}
      {result&&<div className="product-import-preview">
        <p><strong>{result.validCount} lignes valides</strong> · {result.invalidCount} erreurs</p>
        <DataTable headers={['LIGNE','SKU','ACTION','VALIDATION']}
          rows={result.lines.map(line=>[
            line.row,line.sku,line.action,
            line.error?<Status label={line.error} type="red"/>:<Status label="Prête" type="green"/>,
          ])}/>
        <div className="ref-form-actions">
          <SmallButton onClick={()=>{setFile(null);setResult(null);}}>Annuler</SmallButton>
          <SmallButton kind="blue" onClick={()=>void submitImport()}
            disabled={!result.canImport||busy}>Confirmer l'import</SmallButton>
        </div>
      </div>}
    </Panel>}
  </div>;
}
