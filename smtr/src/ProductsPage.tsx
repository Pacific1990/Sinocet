import { useState, type FormEvent } from 'react';
import { DataTable, Field, Filters, Loading, Notice, Panel, SmallButton, Status, SubmitButton, useRemote } from './CatalogueUI';
import { displayError, fcfa, patch, post } from './services';
import { downloadExcelTemplate, uploadExcel, type ImportPreview } from './importExcel';
import type { Role } from './permissions';

type CharacteristicEntry={characteristicId:string;name?:string;value:string};
type NamedReference={id:string;name:string;description?:string;brandId?:string};
type SupplierReference={id:string;code:string;name:string};
type References={
  brands:NamedReference[];models:NamedReference[];characteristics:NamedReference[];
  suppliers:SupplierReference[];
};
type Product={
  id:string;productId:string;sku:string;name:string;category:string;description:string;
  brandId:string;modelId:string;brand:string|null;modelName:string|null;
  characteristics:CharacteristicEntry[];
  trackingMode:string;minimumLevel:number;salePriceF:number|null;available:number|null;active:boolean;
};
type Draft={
  sku:string;name:string;category:string;description:string;brandId:string;modelId:string;
  characteristics:CharacteristicEntry[];trackingMode:string;minimumLevel:string;
  salePriceF:string;purchaseCostF:string;
};
type Props={token:string|null;role:Role;preview:boolean;refresh:number;onLogout:()=>void;onRefresh:()=>void};
const emptyDraft:Draft={
  sku:'',name:'',category:'',description:'',brandId:'',modelId:'',
  characteristics:[],trackingMode:'individual',minimumLevel:'0',
  salePriceF:'',purchaseCostF:'',
};
function fromProduct(p:Product):Draft{
  return {
    sku:p.sku,name:p.name,category:p.category,description:p.description||'',
    brandId:p.brandId||'',modelId:p.modelId||'',
    characteristics:(p.characteristics||[]).map(c=>({characteristicId:c.characteristicId,value:c.value})),
    trackingMode:p.trackingMode,minimumLevel:String(p.minimumLevel),
    salePriceF:'',purchaseCostF:'',
  };
}
export default function ProductsPage(props:Props){
  const data=useRemote<{products:Product[]}>(props.token,'/catalog/products',props.refresh,props.onLogout);
  const products=data.data?.products||[];
  const references=useRemote<References>(props.token,'/catalog/references',props.refresh,props.onLogout);
  const brands=references.data?.brands||[];
  const models=references.data?.models||[];
  const characteristics=references.data?.characteristics||[];
  const canManage=props.role==='manager'||props.role==='director';
  const director=props.role==='director';
  const [view,setView]=useState<'list'|'form'|'detail'|'import'|'references'>('list');
  const [selected,setSelected]=useState('');
  const [form,setForm]=useState<Draft>(emptyDraft);
  const [query,setQuery]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [result,setResult]=useState<ImportPreview|null>(null);
  const [referenceKind,setReferenceKind]=useState<'brands'|'models'|'characteristics'>('brands');
  const [referenceName,setReferenceName]=useState('');
  const [referenceDescription,setReferenceDescription]=useState('');
  const [referenceBrandId,setReferenceBrandId]=useState('');
  const chosen=products.find(x=>x.id===selected);
  const filtered=products.filter(p=>
    (p.name+' '+p.sku+' '+p.category+' '+(p.brand||'')+' '+(p.modelName||''))
      .toLowerCase().includes(query.toLowerCase()));
  function back(){setView('list');setError('');setFile(null);setResult(null);}
  function create(){setSelected('');setForm({...emptyDraft});setError('');setView('form');}
  function edit(p:Product){setSelected(p.id);setForm(fromProduct(p));setError('');setView('form');}
  function setField(key:Exclude<keyof Draft,'characteristics'>,value:string){
    setForm(old=>({...old,[key]:value,...(key==='brandId'?{modelId:''}:{})}));
  }
  function setCharacteristic(id:string,value:string){
    setForm(old=>({
      ...old,characteristics:[
        ...old.characteristics.filter(c=>c.characteristicId!==id),
        ...(value.trim()?[{characteristicId:id,value}]:[]),
      ],
    }));
  }
  async function saveReference(event:FormEvent){
    event.preventDefault();if(!props.token||!canManage||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      await post('/catalog/references/'+referenceKind,props.token,{
        name:referenceName,description:referenceDescription||referenceName,
        ...(referenceKind==='models'?{brandId:referenceBrandId}:{}),
      });
      setNotice('Référentiel ajouté.');
      setReferenceName('');setReferenceDescription('');
      references.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}
    finally{setBusy(false);}
  }
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
    ?(selected?'Modifier le produit':'Nouveau produit'):view==='detail'?'Fiche produit'
      :view==='references'?'Référentiels produits':'Importer des produits';
  const backAction=view==='list'?undefined:<SmallButton onClick={back}>Retour aux produits</SmallButton>;
  if(props.preview)return <Panel title="Produits"><p className="catalog-note">Aperçu sans données. Aucune création possible.</p></Panel>;
  return <div className="smtr-ref product-catalog">
    {notice&&<Notice tone="success">{notice}</Notice>}
    {(error||data.error||references.error)&&<Notice tone="error">{error||data.error||references.error}</Notice>}
    {view==='list'&&<Panel title={heading} subtitle="Références, caractéristiques, variantes et disponibilité"
      action={<>
        {canManage&&<SmallButton onClick={()=>{setError('');setView('references');}}>Marques, modèles et caractéristiques</SmallButton>}
        {canManage&&<SmallButton onClick={()=>{setError('');setFile(null);setResult(null);setView('import');}}>Importer Excel</SmallButton>}
        {canManage&&<SmallButton onClick={create} kind="blue">+ Nouveau produit</SmallButton>}
      </>}>
      <Filters><Field label="Rechercher une référence"><input value={query}
        onChange={e=>setQuery(e.target.value)} placeholder="Nom, SKU, modèle ou marque"/></Field></Filters>
      {data.loading?<Loading/>:<DataTable
        headers={['PRODUIT','SKU','CATÉGORIE','SUIVI','DISPONIBLE','PRIX VENTE','STATUT','ACTIONS']}
        rows={filtered.map(p=>[
          <span><strong>{p.name}</strong><br/><small>{[p.brand,p.modelName,...((p.characteristics||[]).map(x=>x.value).slice(0,1))].filter(Boolean).join(' · ')}</small></span>,
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
          ['Suivi',chosen.trackingMode==='standard'?'Par quantité':'Par IMEI'],
          ['Seuil mini',String(chosen.minimumLevel)],
          ['Stock disponible',chosen.available==null?'Non accessible':String(chosen.available)],
          ['Prix de vente',chosen.salePriceF==null?'Non défini':fcfa(chosen.salePriceF)],
          ['Description',chosen.description],
          ...(chosen.characteristics||[]).map(c=>[c.name||'Caractéristique',c.value]),
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
          <Field label="Marque (référentiel)">
            <select value={form.brandId} onChange={e=>setField('brandId',e.target.value)}>
              <option value="">Aucune marque</option>
              {brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Modèle (lié à la marque)">
            <select value={form.modelId} disabled={!form.brandId}
              onChange={e=>setField('modelId',e.target.value)}>
              <option value="">Aucun modèle</option>
              {models.filter(m=>m.brandId===form.brandId).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
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
        <h3>Caractéristiques configurables</h3>
        <p className="catalog-note">Les caractéristiques sont définies une seule fois dans les référentiels ; leur valeur dépend de chaque produit. Aucun champ n'est spécifique aux téléphones.</p>
        <div className="product-form-grid">
          {characteristics.map(c=><Field key={c.id} label={c.name}>
            <input maxLength={1000} value={form.characteristics.find(x=>x.characteristicId===c.id)?.value||''}
              onChange={e=>setCharacteristic(c.id,e.target.value)}/>
          </Field>)}
        </div>
        {!characteristics.length&&<p className="catalog-note">Aucune caractéristique définie. Utilisez le menu Référentiels produits pour en créer.</p>}
        <Field label="Description"><textarea rows={3} maxLength={1000} value={form.description}
          onChange={e=>setField('description',e.target.value)}/></Field>
        {selected&&<p className="catalog-note">Un changement de suivi IMEI/quantité est bloqué si des unités ont déjà été réceptionnées.</p>}
        <div className="ref-form-actions"><SmallButton onClick={back}>Annuler</SmallButton>
          <SubmitButton disabled={busy}>{busy?'Enregistrement…':'Enregistrer le produit'}</SubmitButton>
        </div>
      </form>
    </Panel>}
    {view==='references'&&<Panel title={heading}
      subtitle="Référentiels réutilisables par l'ensemble des produits de l'entreprise"
      action={backAction}>
      <form className="catalog-form product-form" onSubmit={saveReference}>
        <div className="product-form-grid">
          <Field label="Type de référentiel">
            <select value={referenceKind}
              onChange={e=>setReferenceKind(e.target.value as 'brands'|'models'|'characteristics')}>
              <option value="brands">Marque</option>
              <option value="models">Modèle</option>
              <option value="characteristics">Caractéristique</option>
            </select>
          </Field>
          {referenceKind==='models'&&<Field label="Marque parente *">
            <select required value={referenceBrandId} onChange={e=>setReferenceBrandId(e.target.value)}>
              <option value="">Choisir une marque</option>
              {brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>}
          <Field label="Nom *"><input minLength={2} maxLength={150} required
            value={referenceName} onChange={e=>setReferenceName(e.target.value)}/></Field>
          <Field label="Description"><input maxLength={1000}
            value={referenceDescription} onChange={e=>setReferenceDescription(e.target.value)}/></Field>
        </div>
        <div className="ref-form-actions">
          <SubmitButton disabled={busy}>{busy?'Enregistrement…':'Ajouter la référence'}</SubmitButton>
        </div>
      </form>
      <h3>Marques</h3>
      <DataTable headers={['MARQUE','DESCRIPTION']}
        rows={brands.map(b=>[b.name,b.description||'—'])}/>
      <h3>Modèles</h3>
      <DataTable headers={['MARQUE','MODÈLE','DESCRIPTION']}
        rows={models.map(m=>[brands.find(b=>b.id===m.brandId)?.name||'—',m.name,m.description||'—'])}/>
      <h3>Caractéristiques</h3>
      <DataTable headers={['NOM','DESCRIPTION']}
        rows={characteristics.map(c=>[c.name,c.description||'—'])}/>
    </Panel>}
    {view==='import'&&<Panel title={heading} subtitle="Aperçu obligatoire avant toute création ou modification" action={backAction}>
      <p className="catalog-note">Remplissez PRODUITS et, si nécessaire, CARACTERISTIQUES. Les marques, modèles et caractéristiques doivent déjà exister dans les référentiels. ACTION vaut CREER ou MODIFIER : aucune modification silencieuse. Seule la Direction peut importer des prix.</p>
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
