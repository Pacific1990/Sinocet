import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { DataTable, Empty, Field, Filters, Loading, Metric, Notice, Panel, SmallButton, Status, SubmitButton, useRemote } from './CatalogueUI';
import { displayError, patch, post, put, shortDate } from './services';
import type { ModuleId } from './permissions';

type Props={
  screen:ModuleId;token:string|null;preview:boolean;refresh:number;onLogout:()=>void;onRefresh:()=>void;
};
type Person={id:string;name:string;email:string;role:string;active:boolean;has2fa:boolean;hasManagerCode:boolean;stockName:string|null};
type Role={id:string;code:string;name:string;description:string;permissionsCount:number;editable:boolean};
type Permission={id:string;code:string;name:string;description:string;category:'system'|'business';editableFor:string[]};
type Menu={id:string;code:string;name:string;permission:string;active:boolean;defaultSort:number;roles:Array<{role:string;visible:boolean;sortOrder:number}>};
type Setting={key:string;value:number|string|boolean;updatedAt:string};
type Audit={id:string;actor:string;action:string;entity:string;occurredAt:string};

async function save<T>(path:string,token:string,body:unknown):Promise<T>{
  return put<T>(path,token,body);
}
const roleNames:Record<string,string>={admin:'Administrateur',director:'Direction',manager:'Manager',agent:'Agent'};
const editRoles=['director','manager','agent'];
const descriptions:Record<string,string>={
  'security.require_2fa':'Exiger la double authentification pour les profils Administrateur et Direction',
  'company.name':'Dénomination affichée dans les espaces SMTR',
  'alerts.transit_days':'Nombre de jours avant une alerte de transfert en retard',
  'alerts.sav_days':'Nombre de jours avant une alerte de dossier SAV',
  'ui.page_size':'Nombre de lignes à afficher dans les tableaux',
};

function AdminOverview(props:Props){
  const request=useRemote<{metrics:Array<{id:string;label:string;value:number}>}>(
    props.token,'/system/overview',props.refresh,props.onLogout
  );
  return <div className="smtr-ref">
    <div className="catalog-metrics">
      {request.data?.metrics.map(m=><Metric key={m.id} label={m.label} value={m.value}/>)}
    </div>
    <Panel title="Espace Administrateur" subtitle="Administration technique — hors opérations financières">
      {request.loading?<Loading/>:request.error?<Notice tone="error">{request.error}</Notice>:
        <div className="catalog-grid">
          <article className="catalog-inner-panel"><h3 className="catalog-card-title">Gestion des accès</h3>
            <p className="catalog-note">Les permissions sont vérifiées par le serveur à chaque demande. Les changements de droits révoquent les sessions des rôles concernés.</p>
          </article>
          <article className="catalog-inner-panel"><h3 className="catalog-card-title">Séparation des responsabilités</h3>
            <p className="catalog-note">L’Administrateur gère les comptes et les menus. Il n’a pas accès au chiffre d’affaires, aux coûts d’achat, aux créances ni aux stocks métiers.</p>
          </article>
        </div>}
    </Panel>
  </div>;
}

function AdminUsers(props:Props){
  const request=useRemote<{users:Person[]}>(props.token,'/users',props.refresh,props.onLogout);
  const [creating,setCreating]=useState(false);
  const [name,setName]=useState('');
  const [email,setEmail]=useState('');
  const [role,setRole]=useState('agent');
  const [password,setPassword]=useState('');
  const [warehouse,setWarehouse]=useState('');
  const [approvalCode,setApprovalCode]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [filter,setFilter]=useState('');
  async function create(event:FormEvent){
    event.preventDefault();
    if(!props.token||busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      const result=await post<{user:{id:string}}>('/users',props.token,{
        name,email,role,temporaryPassword:password,
        ...(role==='agent'?{warehouseName:warehouse}:{}),
        ...(role==='manager'?{approvalCode}:{})
      });
      setMessage('Compte #'+result.user.id+' créé avec succès. Transmettez ses accès par un canal sécurisé.');
      setName('');setEmail('');setPassword('');setWarehouse('');setApprovalCode('');
      setCreating(false);request.reload();
    }catch(e){setError(displayError(e,props.onLogout));}
    finally{setBusy(false);}
  }
  async function setActive(user:Person){
    if(!props.token||busy)return;
    if(!window.confirm((user.active?'Désactiver':'Activer')+' le compte '+user.name+' ?'))return;
    setBusy(true);setError('');setMessage('');
    try{
      await patch('/users/'+user.id,props.token,{active:!user.active});
      setMessage('Accès du compte mis à jour.');request.reload();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  const users=(request.data?.users||[]).filter(u=>
    (u.name+' '+u.email+' '+u.role).toLowerCase().includes(filter.toLowerCase()));
  return <div className="smtr-ref">
    <Panel title={creating?"Nouvel utilisateur":"Gestion des utilisateurs"} subtitle="Création, habilitation et activation des comptes"
      action={<SmallButton kind="blue" onClick={()=>setCreating(v=>!v)}>{creating?"Retour à la liste":"+ Nouvel utilisateur"}</SmallButton>}>
      {message&&<Notice tone="success">{message}</Notice>}
      {(error||request.error)&&<Notice tone="error">{error||request.error}</Notice>}
      {creating&&<form className="catalog-form catalog-inner-panel" onSubmit={create}>
        <h3 className="catalog-card-title">Créer un utilisateur</h3>
        <div className="catalog-form-row">
          <Field label="Nom complet"><input value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={150}/></Field>
          <Field label="Adresse e-mail"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254}/></Field>
          <Field label="Rôle">
            <select value={role} onChange={e=>setRole(e.target.value)}>
              <option value="agent">Agent</option><option value="manager">Manager</option>
            </select>
          </Field>
          <Field label="Mot de passe provisoire (12 caractères minimum)">
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={12} autoComplete="new-password"/>
          </Field>
          {role==='agent'&&<Field label="Nom de son stock agent">
            <input value={warehouse} onChange={e=>setWarehouse(e.target.value)} required minLength={3}/>
          </Field>}
          {role==='manager'&&<Field label="Code Manager de validation (6 chiffres)">
            <input value={approvalCode} onChange={e=>setApprovalCode(e.target.value.replace(/\D/g,''))} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required type="password"/>
          </Field>}
        </div>
        <p className="catalog-note">Les comptes Direction et Administrateur sont provisionnés via une procédure sécurisée avec double authentification obligatoire.</p>
        <div className="catalog-actions">
          <SmallButton onClick={()=>setCreating(false)}>Annuler</SmallButton>
          <SubmitButton disabled={busy}>{busy?'Création…':'Créer le compte'}</SubmitButton>
        </div>
      </form>}
      {!creating&&<>
      <Filters><Field label="Rechercher un utilisateur">
        <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Nom, email, rôle"/>
      </Field></Filters>
      {request.loading?<Loading/>:<DataTable
        headers={['NOM','RÔLE','ÉTAT','DOUBLE AUTH.','STOCK AGENT','ACTION']}
        rows={users.map(user=>[
          <span key={user.id}><strong>{user.name}</strong><br/><small>{user.email}</small></span>,
          roleNames[user.role]||user.role,
          <Status label={user.active?'Actif':'Inactif'}/>,
          user.has2fa?'Activée':user.hasManagerCode?'Code Manager':'—',
          user.stockName||'—',
          user.role==='admin'||user.role==='director'
            ?<span key={user.id} className="catalog-inline-chip">Compte protégé</span>
            :<SmallButton key={user.id} disabled={busy} onClick={()=>setActive(user)}>
              {user.active?'Désactiver':'Activer'}</SmallButton>,
        ])}/>}</>}
    </Panel>
  </div>;
}

function AdminPermissions(props:Props){
  const roles=useRemote<{roles:Role[]}>(props.token,'/system/roles',props.refresh,props.onLogout);
  const access=useRemote<{permissions:Permission[];grants:Record<string,string[]>}>(
    props.token,'/system/permissions',props.refresh,props.onLogout
  );
  const [role,setRole]=useState('manager');
  const [checked,setChecked]=useState<string[]>([]);
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!dirty)setChecked(access.data?.grants[role]||[]);
  },[access.data,role,dirty]);
  function chooseRole(next:string){setRole(next);setDirty(false);setChecked(access.data?.grants[next]||[]);setMessage('');setError('');}
  function toggle(code:string){
    if(code==='dashboard.view')return;
    setDirty(true);setChecked(v=>v.includes(code)?v.filter(x=>x!==code):[...v,code]);
  }
  async function submit(){
    if(!props.token||busy||!dirty)return;
    setBusy(true);setMessage('');setError('');
    try{
      await save('/system/roles/'+role+'/permissions',props.token,{permissions:checked});
      setMessage('Permissions du rôle '+(roleNames[role]||role)+' enregistrées. Les sessions correspondantes ont été révoquées.');
      setDirty(false);access.reload();roles.reload();
      props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  const list=access.data?.permissions.filter(p=>p.category==='business'&&p.editableFor.includes(role))||[];
  return <div className="smtr-ref">
    <Panel title="Rôles & permissions" subtitle="Droits explicites par rôle — contrôlés par l’API">
      {(access.error||roles.error||error)&&<Notice tone="error">{access.error||roles.error||error}</Notice>}
      {message&&<Notice tone="success">{message}</Notice>}
      <div className="catalog-warning-box">
        <strong>Administrateur technique ≠ Direction.</strong> L’Administrateur ne peut pas s’attribuer de permissions commerciales. Les rôles métier possèdent chacun un périmètre maximal qui ne peut pas être dépassé depuis ce panneau.
      </div>
      <Filters>
        <Field label="Configurer le rôle">
          <select value={role} onChange={e=>chooseRole(e.target.value)}>
            {editRoles.map(key=><option key={key} value={key}>{roleNames[key]}</option>)}
          </select>
        </Field>
      </Filters>
      {access.loading?<Loading/>:<>
        <div className="catalog-inline-list">
          {list.map(permission=><label key={permission.id} className="catalog-row">
            <span><strong>{permission.name}</strong><br/><small>{permission.description}</small></span>
            <input type="checkbox" checked={checked.includes(permission.code)}
              onChange={()=>toggle(permission.code)} disabled={permission.code==='dashboard.view'||busy}/>
          </label>)}
        </div>
        <div className="catalog-actions" style={{marginTop:16}}>
          <SmallButton onClick={()=>chooseRole(role)} disabled={!dirty}>Annuler les changements</SmallButton>
          <SmallButton kind="blue" disabled={!dirty||busy} onClick={submit}>
            {busy?'Enregistrement…':'Enregistrer les permissions'}
          </SmallButton>
        </div>
      </>}
    </Panel>
    <Panel title="Synthèse des profils" subtitle="Nombre de permissions effectivement accordées">
      <DataTable headers={['RÔLE','PERMISSIONS','TYPE']}
        rows={(roles.data?.roles||[]).map(x=>[
          x.name,x.permissionsCount,x.code==='admin'?'Administration technique':'Opérations métier'
        ])}/>
    </Panel>
  </div>;
}

function AdminMenus(props:Props){
  const request=useRemote<{menus:Menu[]}>(props.token,'/system/menus',props.refresh,props.onLogout);
  const [role,setRole]=useState('manager');
  const [items,setItems]=useState<string[]>([]);
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const all=request.data?.menus||[];
  const allForRole=all.filter(m=>m.roles.some(r=>r.role===role));
  const ordered=useMemo(()=>{
    const byCode=new Map(allForRole.map(item=>[item.code,item]));
    return items.map(code=>byCode.get(code)).filter((x):x is Menu=>Boolean(x));
  },[items,allForRole]);
  useEffect(()=>{
    if(!dirty){
      const visible=allForRole.filter(m=>m.roles.find(r=>r.role===role)?.visible)
        .sort((a,b)=>(a.roles.find(r=>r.role===role)?.sortOrder||100)-
                     (b.roles.find(r=>r.role===role)?.sortOrder||100)).map(m=>m.code);
      setItems(visible);
    }
  },[request.data,role,dirty]);
  function chooseRole(next:string){setRole(next);setDirty(false);setError('');setMessage('');}
  function toggle(code:string){
    if(code==='dashboard')return;
    setDirty(true);
    setItems(v=>v.includes(code)?v.filter(x=>x!==code):[...v,code]);
  }
  function move(index:number,delta:number){
    const next=index+delta;
    if(next<0||next>=items.length)return;
    setItems(v=>{
      const copy=[...v];[copy[index],copy[next]]=[copy[next],copy[index]];return copy;
    });
    setDirty(true);
  }
  async function submit(){
    if(!props.token||busy||!dirty)return;
    setBusy(true);setError('');setMessage('');
    try{
      await save('/system/roles/'+role+'/menus',props.token,{menus:items});
      setMessage('Visibilité et ordre des menus enregistrés pour '+roleNames[role]+'.');
      setDirty(false);request.reload();props.onRefresh();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(false);}
  }
  return <div className="smtr-ref">
    <Panel title="Menus par rôle" subtitle="Visibilité et ordre d’affichage, sans modification du design des maquettes">
      {(error||request.error)&&<Notice tone="error">{error||request.error}</Notice>}
      {message&&<Notice tone="success">{message}</Notice>}
      <Filters><Field label="Rôle à configurer">
        <select value={role} onChange={e=>chooseRole(e.target.value)}>
          {editRoles.map(x=><option value={x} key={x}>{roleNames[x]}</option>)}
        </select>
      </Field></Filters>
      {request.loading?<Loading/>:<>
        <p className="catalog-note">Déplacer un menu ne donne pas la permission d’y accéder. Un menu désactivé reste inaccessible dans la navigation même si la permission est accordée.</p>
        <div className="catalog-inline-list">
          {ordered.map((menu,index)=><div key={menu.code} className="catalog-row">
            <div><strong>{menu.name}</strong><br/><small>{menu.permission}</small></div>
            <div className="catalog-actions">
              <SmallButton disabled={index===0||busy} onClick={()=>move(index,-1)}><ChevronUp size={16}/></SmallButton>
              <SmallButton disabled={index===ordered.length-1||busy} onClick={()=>move(index,1)}><ChevronDown size={16}/></SmallButton>
              <SmallButton disabled={menu.code==='dashboard'||busy} onClick={()=>toggle(menu.code)}>Masquer</SmallButton>
            </div>
          </div>)}
        </div>
        <h3 className="catalog-section-title">Autres menus autorisés</h3>
        <div className="catalog-tab-group">{allForRole.filter(m=>!items.includes(m.code)).map(m=>
          <button key={m.code} className="catalog-tab" type="button"
            onClick={()=>toggle(m.code)}>+ {m.name}</button>)}</div>
        <div className="catalog-actions">
          <SmallButton disabled={!dirty} onClick={()=>chooseRole(role)}>Annuler</SmallButton>
          <SmallButton kind="blue" disabled={!dirty||busy} onClick={submit}>
            {busy?'Enregistrement…':'Enregistrer les menus'}
          </SmallButton>
        </div>
      </>}
    </Panel>
  </div>;
}

function AdminSettings(props:Props){
  const request=useRemote<{settings:Setting[]}>(props.token,'/system/settings',props.refresh,props.onLogout);
  const [current,setCurrent]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState<string|null>(null);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{
    if(request.data)setCurrent(Object.fromEntries(request.data.settings.map(s=>[s.key,String(s.value)])));
  },[request.data]);
  async function submit(key:string){
    if(!props.token||busy)return;
    const old=request.data?.settings.find(x=>x.key===key);
    if(!old)return;
    const raw=current[key]||'';
    const value=typeof old.value==='boolean'?raw==='true':typeof old.value==='number'?Number(raw):raw;
    setBusy(key);setError('');setMessage('');
    try{
      await save('/system/settings/'+encodeURIComponent(key),props.token,{value});
      if(key==='security.require_2fa'&&value===true){props.onLogout();return;}
      setMessage('Paramètre '+key+' mis à jour.');request.reload();
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy(null);}
  }
  return <div className="smtr-ref">
    <Panel title="Paramètres de l’application" subtitle="Configuration technique et seuils d’alerte">
      {(error||request.error)&&<Notice tone="error">{error||request.error}</Notice>}
      {message&&<Notice tone="success">{message}</Notice>}
      {request.loading?<Loading/>:!request.data?.settings.length?<Empty>Aucun paramètre défini.</Empty>:
        <div className="catalog-inline-list">{request.data.settings.map(item=>
          <div className="catalog-inner-panel" key={item.key}>
            <div className="catalog-form-row" style={{alignItems:'end'}}>
              <Field label={item.key+' · '+(descriptions[item.key]||'Paramètre')}>
                {typeof item.value==='boolean'?
                  <select value={current[item.key]??String(item.value)} onChange={e=>setCurrent(s=>({...s,[item.key]:e.target.value}))}>
                    <option value="true">Obligatoire</option>
                    <option value="false">Facultative</option>
                  </select>:
                  <input type={typeof item.value==='number'?'number':'text'}
                  value={current[item.key]??String(item.value)} onChange={e=>setCurrent(s=>({...s,[item.key]:e.target.value}))}
                  min={typeof item.value==='number'?0:undefined}/>}
              </Field>
              <SmallButton kind="blue" disabled={Boolean(busy)||String(item.value)===(current[item.key]??'')}
                onClick={()=>submit(item.key)}>Enregistrer</SmallButton>
            </div>
            <p className="catalog-note">Dernière mise à jour : {shortDate(item.updatedAt)}</p>
          </div>)}</div>}
    </Panel>
  </div>;
}

function AdminAudit(props:Props){
  const request=useRemote<{events:Audit[]}>(props.token,'/system/audit',props.refresh,props.onLogout);
  return <div className="smtr-ref">
    <Panel title="Journal de configuration" subtitle="Traçabilité des décisions d’administration, sans accès aux ventes">
      {request.error&&<Notice tone="error">{request.error}</Notice>}
      {request.loading?<Loading/>:<DataTable
        headers={['DATE','UTILISATEUR','ACTION','OBJET']}
        rows={(request.data?.events||[]).map(event=>[
          shortDate(event.occurredAt),event.actor,event.action,event.entity+' #'+event.id
        ])}/>}
    </Panel>
  </div>;
}

export default function AdminPage(props:Props){
  if(props.preview)return <Panel title="Administration SMTR"><Empty>Connectez-vous avec un compte Administrateur et la double authentification pour consulter les paramètres.</Empty></Panel>;
  switch(props.screen){
    case 'system':return <AdminOverview {...props}/>;
    case 'users':return <AdminUsers {...props}/>;
    case 'permissions':return <AdminPermissions {...props}/>;
    case 'menus':return <AdminMenus {...props}/>;
    case 'settings':return <AdminSettings {...props}/>;
    case 'system_audit':return <AdminAudit {...props}/>;
    default:return <Notice tone="error">Écran d’administration inconnu.</Notice>;
  }
}
