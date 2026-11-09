import { ApplicationSettings } from './CatalogueUI';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Activity, AlertCircle, ArrowLeftRight, ArrowRight, Boxes, BriefcaseBusiness,
  CheckCircle2, ChevronRight, ClipboardCheck, CreditCard, FileText,
  Fingerprint, LayoutDashboard, LoaderCircle, LogOut, Menu, RefreshCw,
  Settings2, Shield, ShieldCheck, ShoppingBag, Smartphone, Users, Wallet,
  ListChecks, SlidersHorizontal, BarChart3, X,
  type LucideIcon,
} from 'lucide-react';
import { login, activateOrganization, setupMfa, confirmMfa, MfaEnrollmentRequired, type MfaEnrollment, logout as logoutRemote, type Session } from './api';
import { ApiError } from './api';
import { get, post } from './services';
import { isModule, isRole, roleModules, type ModuleId, type Role } from './permissions';
import Operations from './Operations';
import DashboardPage from './DashboardPage';
import SalesPage from './SalesPage';
import DebtsPage from './DebtsPage';
import CashPage from './CashPage';
import SavPage from './SavPage';
import InventoryPage from './InventoryPage';
import ApprovalsPage from './ApprovalsPage';
import ReportsPage from './ReportsPage';
import SupervisionPage from './SupervisionPage';
import BusinessSettingsPage from './BusinessSettingsPage';
import AuditPage from './AuditPage';
import AdminPage from './AdminPage';

type NavDef={title:string;description:string;icon:LucideIcon;label:string};
type Access={settings?:{companyName:string;pageSize:number};role:Role;permissions:string[];navigation:Array<{id:string;label:string;sortOrder:number}>};
const MODULES:Record<ModuleId,NavDef>={
  system:{title:'Administration SMTR',description:'Paramètres, habilitations et suivi technique du système.',icon:Settings2,label:'Administration'},
  users:{title:'Utilisateurs',description:'Création et gestion des comptes autorisés.',icon:Users,label:'Utilisateurs'},
  permissions:{title:'Rôles & permissions',description:'Droits explicites et contrôle des accès par rôle.',icon:ShieldCheck,label:'Permissions'},
  menus:{title:'Menus par rôle',description:'Visibilité et organisation des menus par profil.',icon:ListChecks,label:'Menus par rôle'},
  settings:{title:'Paramètres système',description:'Configuration technique des alertes et de l’application.',icon:SlidersHorizontal,label:'Paramètres'},
  system_audit:{title:'Journal technique',description:'Traçabilité des changements de configuration.',icon:Shield,label:'Journal technique'},
  dashboard:{title:'Tableau de bord',description:'Suivi opérationnel en temps réel selon votre périmètre.',icon:LayoutDashboard,label:'Accueil'},
  stocks:{title:'Stock Central & IMEI',description:'Produits, lots et disponibilité par catégorie.',icon:Boxes,label:'Stocks'},
  transfers:{title:'Transferts',description:'Du Stock Central vers les agents avec validation de réception.',icon:ArrowLeftRight,label:'Transferts'},
  sales:{title:'Point de vente',description:'Ventes, reçus et stock de l’agent attribué.',icon:ShoppingBag,label:'Ventes'},
  debts:{title:'Dettes & crédits',description:'Créances clients, plafonds et échéances.',icon:CreditCard,label:'Crédits'},
  cases:{title:'SAV — Ramba',description:'Retours pour défaut d’usine et entrepôt virtuel.',icon:BriefcaseBusiness,label:'SAV'},
  cash:{title:'Ma caisse',description:'Encaissements et clôtures de caisse.',icon:Wallet,label:'Caisse'},
  inventory:{title:'Inventaires',description:'Contrôles tournants et gel ciblé du stock agent.',icon:ClipboardCheck,label:'Inventaire'},
  approvals:{title:'Validations',description:'Demandes, remises et décisions sensibles.',icon:CheckCircle2,label:'Validations'},
  reports:{title:'Rapports & exports',description:'Rapports PDF et Excel sur les données autorisées.',icon:FileText,label:'Rapports'},
  supervision:{title:'Cartographie des stocks',description:'Supervision des dépôts, stocks agents et transferts.',icon:BarChart3,label:'Supervision'},
  business_settings:{title:'Paramètres produits',description:'Références, tarifs et plafonds financiers.',icon:SlidersHorizontal,label:'Produits & tarifs'},
  audit:{title:'Journal d’audit',description:'Traçabilité métier des opérations sensibles.',icon:Shield,label:'Audit'},
};
const ROLE_LABELS:Record<Role,string>={admin:'Administrateur',director:'Direction',manager:'Manager',agent:'Agent terrain'};

function previewRole():Role|null{
  if(!import.meta.env.DEV||typeof window==='undefined')return null;
  const next=new URLSearchParams(window.location.search).get('preview');
  return isRole(next)?next:null;
}
function Brand({compact=false}:{compact?:boolean}){
  return <div className={'brand '+(compact?'brand--compact':'')}>
    <span className="brand-mark" aria-hidden="true"><Activity size={23} strokeWidth={2.8}/></span>
    <span className="brand-words"><strong>SMTR</strong><small>SINOCET ELECTRONICS</small></span>
  </div>;
}
function Login({onSuccess}:{onSuccess:(session:Session)=>void}){
  const [enrollment,setEnrollment]=useState<MfaEnrollment|null>(null);
  const [pending,setPending]=useState<Session|null>(null);
  const [organizationId,setOrganizationId]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [otp,setOtp]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function submit(event:FormEvent){
    event.preventDefault();if(busy)return;
    setBusy(true);setError('');
    try{
      if(pending){onSuccess(await activateOrganization(pending,organizationId));return;}
      let session:Session;
      try{session=enrollment?await confirmMfa(enrollment.enrollmentToken,otp.trim()):await login(email.trim(),password,otp.trim()||undefined);}
      catch(e){if(e instanceof MfaEnrollmentRequired){setEnrollment(await setupMfa(email.trim(),password));setPassword('');setOtp('');return;}throw e;}
      setEnrollment(null);
      setPassword('');setOtp('');
      if(!session.organizationId){setPending(session);setOrganizationId(session.organizations[0].id);}else onSuccess(session);
    }catch(e){setError(e instanceof Error?e.message:'Connexion impossible.');}
    finally{setBusy(false);}
  }
  return <main className="login-screen">
    <section className="login-story">
      <Brand/>
      <div className="story-content">
        <span className="eyebrow"><span className="glow-dot"/> SYSTÈME DE MANAGEMENT & SUIVI EN TEMPS RÉEL</span>
        <h1>Un regard clair sur chaque mouvement.</h1>
        <p>Stocks, transferts, ventes, crédits et SAV réunis dans un espace pensé pour le terrain.</p>
        <div className="story-features">
          <span><Fingerprint size={19}/> Suivi par IMEI</span>
          <span><Smartphone size={19}/> Mobile First</span>
          <span><Shield size={19}/> Accès par rôle</span>
        </div>
      </div>
      <p className="story-footer">Groupe Sinocet Electronics · SMTR</p>
    </section>
    <section className="login-panel">
      <div className="login-card">
        <div className="mobile-brand"><Brand compact/></div>
        <span className="kicker">ESPACE SÉCURISÉ</span>
        <h2>Bienvenue sur SMTR</h2>
        <p className="muted">Connectez-vous avec les accès fournis par votre organisation.</p>
        <form onSubmit={submit} className="login-form">
          {enrollment&&<div className="catalog-inner-panel"><p>Ajoutez cette cle dans votre application d’authentification, puis saisissez son code a six chiffres.</p><code style={{overflowWrap:'anywhere'}}>{enrollment.secret}</code><p><a href={enrollment.uri}>Ouvrir l’application d’authentification</a></p></div>}
          {pending?<><label htmlFor="smtr-organization">Entreprise POS</label><select id="smtr-organization" required value={organizationId} onChange={e=>setOrganizationId(e.target.value)}>{pending.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></>:<>
          <label htmlFor="smtr-email">Adresse e-mail professionnelle</label>
          <input id="smtr-email" type="email" autoComplete="username" inputMode="email"
            required={!enrollment} disabled={!!enrollment} value={email} onChange={e=>setEmail(e.target.value)} placeholder="nom@entreprise.ci"/>
          <label htmlFor="smtr-password">Mot de passe</label>
          <input id="smtr-password" type="password" autoComplete="current-password"
            required={!enrollment} disabled={!!enrollment} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Votre mot de passe"/>
          <label htmlFor="smtr-otp">Code 2FA — Direction / Administrateur</label>
          <input id="smtr-otp" type="text" inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]{6}" maxLength={6} value={otp}
            onChange={e=>setOtp(e.target.value.replace(/\D/g,''))}
            placeholder="6 chiffres lorsque requis"/>
          </>}
          {error&&<p className="form-error" role="alert"><AlertCircle size={17}/>{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy?<LoaderCircle size={18} className="spin"/>:<>{pending?'Ouvrir mon espace':enrollment?'Confirmer la double authentification':'Se connecter'} <ArrowRight size={18}/></>}
          </button>
        </form>
        <p className="security-hint"><Shield size={15}/> Accès soumis à authentification et autorisations serveur.</p>
        {import.meta.env.DEV&&<p className="dev-preview">Aperçu sans données :
          <a href="?preview=agent"> Agent</a> · <a href="?preview=manager">Manager</a> ·
          <a href="?preview=director">Direction</a> · <a href="?preview=admin">Administrateur</a>
        </p>}
      </div>
      <footer className="login-legal">© 2026 Groupe Sinocet Electronics · Accès réservé au personnel habilité</footer>
    </section>
  </main>;
}

function Workspace({session,preview,onLogout}:{
  session:Session|null;preview:Role|null;onLogout:()=>void;
}){
  const role:Role=session?.user.role??preview??'agent';
  const isPreview=!session;
  const initialScreen:ModuleId=role==='admin'?'system':'dashboard';
  const [screen,setScreen]=useState<ModuleId>(initialScreen);
  const [access,setAccess]=useState<Access|null>(null);
  const [accessError,setAccessError]=useState('');
  const [accessLoading,setAccessLoading]=useState(!isPreview);
  const [menuOpen,setMenuOpen]=useState(false);
  const [online,setOnline]=useState(navigator.onLine);
  const [refresh,setRefresh]=useState(0);
  const [accessReload,setAccessReload]=useState(0);
  const allowed=useMemo(()=>{
    const ids=isPreview?roleModules(role):
      (access?.navigation||[]).map(n=>n.id).filter(isModule);
    return [...new Set(ids)] as ModuleId[];
  },[isPreview,role,access]);
  const navigationLabels=new Map(access?.navigation.map(x=>[x.id,x.label])||[]);
  const nav=MODULES[screen];
  const refreshData=useCallback(()=>setRefresh(x=>x+1),[]);
  const refreshMenus=useCallback(()=>setAccessReload(x=>x+1),[]);

  useEffect(()=>{
    if(isPreview||!session){setAccessLoading(false);return;}
    let active=true;setAccessError('');setAccessLoading(true);
    get<Access>('/access/me',session.accessToken)
      .then(data=>{
        if(!active)return;
        setAccess(data);
        const valid=data.navigation.map(x=>x.id).filter(isModule);
        setScreen(value=>valid.includes(value)?value:(valid[0]||initialScreen));
      })
      .catch(e=>{
        if(!active)return;
        setAccessError(e instanceof Error?e.message:'Impossible de lire les permissions.');
        if(e instanceof ApiError&&e.status===401)onLogout();
      })
      .finally(()=>{if(active)setAccessLoading(false);});
    return()=>{active=false;};
  },[session,isPreview,accessReload,onLogout,initialScreen]);

  useEffect(()=>{
    function connected(){setOnline(true);}
    function disconnected(){setOnline(false);}
    window.addEventListener('online',connected);
    window.addEventListener('offline',disconnected);
    return()=>{window.removeEventListener('online',connected);window.removeEventListener('offline',disconnected);};
  },[]);

  useEffect(()=>{
    if(!session||!navigator.onLine)return;
    let active=true;let socket:WebSocket|null=null;
    let retry:number|null=null;
    async function connect(){
      if(!active||!session)return;
      try{
        const response=await post<{ticket:string}>('/events/ticket',session.accessToken,{});
        if(!active)return;
        const protocol=location.protocol==='https:'?'wss:':'ws:';
        socket=new WebSocket(protocol+'//'+location.host+'/ekolabs/pos/ws?ticket='+encodeURIComponent(response.ticket));
        socket.onmessage=event=>{
          try{const data=JSON.parse(String(event.data));if(data?.event==='refresh'){setRefresh(x=>x+1);if(data.resource==='system')setAccessReload(x=>x+1);}}catch{/* ignore invalid */ }
        };
        socket.onclose=()=>{if(active)retry=window.setTimeout(()=>{void connect();},15000);};
      }catch{/* User can manually refresh if WebSocket is unreachable */ }
    }
    void connect();
    return()=>{
      active=false;if(retry!==null)window.clearTimeout(retry);
      if(socket)socket.close();
    };
  },[session,online]);

  function navigate(next:ModuleId){
    if(!allowed.includes(next))return;
    setScreen(next);setMenuOpen(false);
  }
  const bottomPreferences=role==='admin'?
    ['system','users','permissions','menus','settings'] as ModuleId[]:
    role==='agent'?['dashboard','sales','stocks','debts','cases'] as ModuleId[]:
    ['dashboard','stocks','transfers','reports','supervision'] as ModuleId[];
  const bottom=bottomPreferences.filter(x=>allowed.includes(x));
  const common={token:session?.accessToken??null,preview:isPreview,refresh,onLogout};
  const adminPages=['system','users','permissions','menus','settings','system_audit'] as ModuleId[];

  function renderPage(){
    if(adminPages.includes(screen)){
      return <AdminPage {...common} screen={screen} onRefresh={refreshMenus}/>;
    }
    switch(screen){
      case 'dashboard':return <DashboardPage {...common} role={role} onNavigate={navigate}/>;
      case 'stocks':case 'transfers':return <Operations {...common} screen={screen} role={role} onNavigate={navigate}/>;
      case 'sales':return <SalesPage {...common} role={role} userId={session?.user.id||''} onRefresh={refreshData}/>;
      case 'debts':return <DebtsPage {...common} role={role} onRefresh={refreshData}/>;
      case 'cash':return <CashPage {...common} role={role} onRefresh={refreshData}/>;
      case 'cases':return <SavPage {...common} role={role} onRefresh={refreshData} onNavigate={navigate}/>;
      case 'inventory':return <InventoryPage {...common} onRefresh={refreshData}/>;
      case 'approvals':return <ApprovalsPage {...common} role={role} onRefresh={refreshData}/>;
      case 'reports':return <ReportsPage {...common}/>;
      case 'supervision':return <SupervisionPage {...common} onNavigate={navigate}/>;
      case 'business_settings':return <BusinessSettingsPage {...common} role={role} onRefresh={refreshData}/>;
      case 'audit':return <AuditPage {...common}/>;
      default:return <div className="ref-empty">Ce module est indisponible.</div>;
    }
  }

  return <ApplicationSettings.Provider value={access?.settings||{companyName:'Groupe Sinocet Electronics',pageSize:25}}><div className="workspace">
    <aside className="sidebar">
      <Brand/>
      <div className="sidebar-heading">ESPACE DE TRAVAIL <span>{ROLE_LABELS[role]}</span></div>
      <nav className="sidebar-navigation" aria-label="Navigation principale">
        {allowed.map(id=>{
          const item=MODULES[id],Icon=item.icon;
          return <button key={id} type="button" className={'nav-link '+(screen===id?'is-active':'')}
            aria-current={screen===id?'page':undefined} onClick={()=>navigate(id)}>
            <Icon size={19}/><span>{navigationLabels.get(id)||item.label}</span>
            {screen===id&&<ChevronRight size={15}/>}
          </button>;
        })}
      </nav>
      <div className="sidebar-footer"><span className="sidebar-dot"/>
        <span>{isPreview?'Aperçu sans API':'Session sécurisée'}</span>
        <small>SMTR · Sinocet</small>
      </div>
    </aside>
    <div className="content-shell">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-button mobile-menu-button" type="button"
            aria-label="Tous les modules" aria-expanded={menuOpen} onClick={()=>setMenuOpen(x=>!x)}>
            {menuOpen?<X size={20}/>:<Menu size={20}/>}
          </button>
          <div className="mobile-brand-shell"><Brand compact/></div>
          <div className="desktop-crumb">Sinocet <ChevronRight size={14}/>
            <strong>{navigationLabels.get(screen)||nav.label}</strong>
          </div>
        </div>
        <div className="topbar-right">
          <span className={'connection-status '+(online?'online':'offline')}>
            <span/>{online?'Connecté au réseau':'Hors ligne'}
          </span>
          <button className="profile-pill" type="button" onClick={onLogout} title="Se déconnecter">
            <span className="avatar">{(session?.user.name||ROLE_LABELS[role])[0].toUpperCase()}</span>
            <span className="profile-name">{session?.user.name||ROLE_LABELS[role]}</span>
            <LogOut size={17}/>
          </button>
        </div>
      </header>
      {menuOpen&&<nav className="mobile-drawer" aria-label="Tous les modules">
        {allowed.map(id=>{
          const item=MODULES[id],Icon=item.icon;
          return <button type="button" key={id} onClick={()=>navigate(id)}
            className={'drawer-link '+(screen===id?'is-active':'')}>
            <Icon size={19}/>{navigationLabels.get(id)||item.label}<ChevronRight size={15}/>
          </button>;
        })}
      </nav>}
      <main className="workspace-main" id="main-content">
        {isPreview&&<div className="preview-banner" role="status"><Shield size={17}/>
          Aperçu uniquement : aucune donnée réelle, aucune vente ni opération possible.
        </div>}
        {!online&&<div className="offline-banner" role="alert"><AlertCircle size={17}/>
          Réseau indisponible : les ventes restent des brouillons non validés jusqu’à confirmation serveur.
        </div>}
        {accessError&&<div className="load-error" role="alert">
          <AlertCircle size={20}/><div><strong>Accès indisponible</strong><p>{accessError}</p></div>
          <button type="button" onClick={refreshMenus}>Réessayer</button>
        </div>}
        <div className="page-overline">
          <span className="eyebrow-dark">SMTR / {ROLE_LABELS[role].toUpperCase()}</span>
          <span>{access?.settings?.companyName||'Groupe Sinocet Electronics'}</span>
        </div>
        <div className="page-heading">
          <div><h1>{nav.title}</h1><p>{nav.description}</p></div>
          <button className="icon-button refresh-button" aria-label="Actualiser les données"
            type="button" onClick={()=>{refreshData();refreshMenus();}}
            disabled={isPreview||accessLoading}><RefreshCw size={19}/></button>
        </div>
        {accessLoading?<div className="ref-loading"><LoaderCircle className="spin" size={20}/>
          Chargement des autorisations…</div>:
          allowed.includes(screen)?renderPage():
          <div className="ref-notice ref-notice--warning" role="status">
            Aucun accès à ce module. Contactez l’Administrateur si vous devez y accéder.
          </div>}
        <div className="scope-note">
          <span><Shield size={17}/></span>
          <p>Les permissions, prix, stocks et validations sont contrôlés côté serveur.
            L’accès à un menu ne permet pas de contourner ces contrôles.
          </p>
        </div>
      </main>
      <footer className="app-footer"><span>SMTR · Sinocet Electronics</span>
        <span>Application responsive · Mobile First</span>
      </footer>
    </div>
    <nav className="bottom-navigation" aria-label="Navigation rapide mobile">
      {bottom.map(id=>{
        const item=MODULES[id],Icon=item.icon;
        return <button key={id} type="button" aria-current={screen===id?'page':undefined}
          className={'bottom-link '+(screen===id?'is-active':'')} onClick={()=>navigate(id)}>
          <Icon size={22} strokeWidth={screen===id?2.4:1.9}/>
          <small>{navigationLabels.get(id)||item.label}</small>
        </button>;
      })}
    </nav>
  </div></ApplicationSettings.Provider>;
}

export default function App(){
  const [session,setSession]=useState<Session|null>(null);
  const activeRef=useRef<Session|null>(null);
  const preview=previewRole();
  useEffect(()=>{activeRef.current=session;},[session]);
  const logout=useCallback(()=>{
    const active=activeRef.current;
    if(active)void logoutRemote(active.accessToken).catch(()=>undefined);
    activeRef.current=null;setSession(null);
    if(preview)window.location.assign(window.location.pathname);
  },[preview]);
  useEffect(()=>{
    if(!import.meta.env.PROD||!('serviceWorker' in navigator))return;
    void navigator.serviceWorker.register(import.meta.env.BASE_URL+'sw.js',{scope:import.meta.env.BASE_URL}).catch(()=>undefined);
  },[]);
  return session||preview?<Workspace session={session} preview={preview} onLogout={logout}/>:
    <Login onSuccess={authenticated=>{activeRef.current=authenticated;setSession(authenticated);}}/>;
}
