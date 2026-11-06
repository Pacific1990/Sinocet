import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Activity, AlertCircle, ArrowLeftRight, ArrowRight, BarChart3,
  Boxes, BriefcaseBusiness, CheckCircle2, ChevronRight, ClipboardCheck,
  CreditCard, FileText, Fingerprint, LayoutDashboard, LoaderCircle,
  LogOut, Menu, PackageSearch, RefreshCw, Shield, ShoppingBag,
  Smartphone, Users, Wallet, X,
  type LucideIcon,
} from 'lucide-react';
import { fetchList, fetchMetrics, login, logout as logoutRemote, ApiError, type Session, type ListRecord, type SummaryMetric } from './api';
import Operations from './Operations';
import { canView, isRole, roleModules, type ModuleId, type Role } from './permissions';

type ModuleDefinition = {
  title: string;
  description: string;
  icon: LucideIcon;
  endpoint: string | null;
  label: string;
};

const MODULES: Record<ModuleId, ModuleDefinition> = {
  dashboard: { title: 'Vue d’ensemble', description: 'L’activité en temps réel, selon vos droits.', icon: LayoutDashboard, endpoint: null, label: 'Accueil' },
  stocks: { title: 'Stocks & IMEI', description: 'Positions des articles, réservations et disponibilité réelle.', icon: Boxes, endpoint: '/stocks', label: 'Stocks' },
  transfers: { title: 'Transferts', description: 'Central → agent : en transit jusqu’à réception validée.', icon: ArrowLeftRight, endpoint: '/transfers', label: 'Transferts' },
  sales: { title: 'Point de vente', description: 'Ventes, reçus et disponibilité du stock attribué.', icon: ShoppingBag, endpoint: '/sales', label: 'Ventes' },
  debts: { title: 'Dettes & crédits', description: 'Créances, échéances et encaissements autorisés.', icon: CreditCard, endpoint: '/debts', label: 'Crédits' },
  cases: { title: 'SAV & retours', description: 'Suivi des dossiers et statut Ramba hors stock vendable.', icon: BriefcaseBusiness, endpoint: '/cases', label: 'SAV' },
  cash: { title: 'Ma caisse', description: 'Rapprochement des encaissements journaliers.', icon: Wallet, endpoint: '/cash', label: 'Caisse' },
  inventory: { title: 'Inventaires', description: 'Contrôles ciblés et écarts, sans bloquer les autres agents.', icon: ClipboardCheck, endpoint: '/inventories', label: 'Inventaire' },
  approvals: { title: 'Validations', description: 'Décisions sensibles : remises, annulations et écarts.', icon: CheckCircle2, endpoint: '/approvals', label: 'Validations' },
  reports: { title: 'Rapports', description: 'Rapports périodiques et exports soumis aux permissions.', icon: FileText, endpoint: '/reports', label: 'Rapports' },
  users: { title: 'Utilisateurs & rôles', description: 'Comptes, habilitations et périmètres de responsabilité.', icon: Users, endpoint: '/users', label: 'Utilisateurs' },
  audit: { title: 'Journal d’audit', description: 'Traçabilité horodatée des opérations sensibles.', icon: Shield, endpoint: '/audit/events', label: 'Audit' },
};

const ROLE_LABELS: Record<Role, string> = {
  director: 'Direction', manager: 'Manager', agent: 'Agent terrain',
};

function getPreviewRole(): Role | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search).get('preview');
  return isRole(query) ? query : null;
}

function Brand({ compact = false }: {compact?: boolean}) {
  return (
    <div className={'brand ' + (compact ? 'brand--compact' : '')}>
      <span className="brand-mark" aria-hidden="true"><Activity size={24} strokeWidth={2.7} /></span>
      <span className="brand-words"><strong>SMTR</strong><small>SINOCET ELECTRONICS</small></span>
    </div>
  );
}

function EmptyState({ title, description, icon: Icon = PackageSearch }: {
  title: string;
  description: string;
  icon?: LucideIcon;
}) {
  return <div className="empty-state" role="status">
    <span className="empty-icon"><Icon size={26} /></span>
    <strong>{title}</strong>
    <p>{description}</p>
  </div>;
}

function Login({ onSuccess }: { onSuccess: (session: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const authenticated = await login(email.trim(), password, otp.trim() || undefined);
      setPassword('');
      setOtp('');
      onSuccess(authenticated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de se connecter.');
    } finally {
      setBusy(false);
    }
  }
  return <main className="login-screen">
    <section className="login-story">
      <Brand />
      <div className="story-content">
        <span className="eyebrow"><span className="glow-dot" /> SYSTÈME DE MANAGEMENT & SUIVI EN TEMPS RÉEL</span>
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
        <div className="mobile-brand"><Brand compact /></div>
        <span className="kicker">ESPACE SÉCURISÉ</span>
        <h2>Bienvenue sur SMTR</h2>
        <p className="muted">Connectez-vous avec les accès fournis par votre organisation.</p>
        <form onSubmit={submit} className="login-form">
          <label htmlFor="smtr-email">Adresse e-mail professionnelle</label>
          <input id="smtr-email" type="email" inputMode="email" autoComplete="username" value={email}
            onChange={event => setEmail(event.target.value)} placeholder="nom@entreprise.ci" required />
          <label htmlFor="smtr-password">Mot de passe</label>
          <input id="smtr-password" type="password" autoComplete="current-password" value={password}
            onChange={event => setPassword(event.target.value)} placeholder="Votre mot de passe" required />
          <label htmlFor="smtr-otp">Code de vérification 2FA — Direction</label>
          <input id="smtr-otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            pattern="[0-9]{6}" value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, ""))}
            placeholder="6 chiffres si la double authentification est active" />
          {error && <p className="form-error" role="alert"><AlertCircle size={17} />{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={19} /> : <>Se connecter <ArrowRight size={19}/></>}
          </button>
        </form>
        <p className="security-hint"><Shield size={15}/> Accès soumis à authentification et permissions serveur.</p>
        {import.meta.env.DEV && <p className="dev-preview">Aperçu du design : <a href="?preview=agent">Agent</a> · <a href="?preview=manager">Manager</a> · <a href="?preview=director">Direction</a>. Aucun compte ni donnée simulée.</p>}
      </div>
      <footer className="login-legal">© 2026 Groupe Sinocet Electronics · Accès réservé au personnel habilité</footer>
    </section>
  </main>;
}

function StatusRow({ row }: { row: ListRecord }) {
  return <li className="record-card">
    <span className="record-symbol" aria-hidden="true"><Boxes size={19}/></span>
    <span className="record-main"><strong>{row.title}</strong>{row.subtitle && <small>{row.subtitle}</small>}</span>
    <span className="record-side">{row.status && <span className="status-chip">{row.status}</span>}{row.meta && <small>{row.meta}</small>}</span>
  </li>;
}

function MetricsView({ metrics, loading }: {metrics: SummaryMetric[]; loading: boolean}) {
  if (loading) return <div className="loading" role="status"><LoaderCircle className="spin"/> Chargement des indicateurs…</div>;
  if (!metrics.length) return <EmptyState title="Aucun indicateur disponible" description="Les chiffres apparaîtront ici lorsque l’API SMTR renverra les données autorisées pour votre rôle." icon={BarChart3}/>;
  return <div className="metrics-grid">{metrics.map(metric =>
    <article className="metric-card" key={metric.id}>
      <span className="metric-label">{metric.label}</span>
      <strong className="metric-value">{metric.value}</strong>
      {metric.hint && <small className="metric-hint">{metric.hint}</small>}
    </article>)}</div>;
}

function Workspace({ session, previewRole, onLogout }: {
  session: Session | null; previewRole: Role | null; onLogout: () => void;
}) {
  const role = session?.user.role ?? previewRole ?? 'agent';
  const preview = session === null;
  const [screen, setScreen] = useState<ModuleId>('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [metrics, setMetrics] = useState<SummaryMetric[]>([]);
  const [rows, setRows] = useState<ListRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const allowed = useMemo(() => roleModules(role), [role]);
  const nav = MODULES[screen];
  const bottomNav = role === 'agent'
    ? (['dashboard', 'sales', 'stocks', 'debts', 'cases'] as const)
    : (['dashboard', 'stocks', 'transfers', 'reports', 'cases'] as const);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  useEffect(() => {
    if (preview || !session || !canView(role, screen) || screen === 'stocks' || screen === 'transfers') return;
    const controller = new AbortController();
    setBusy(true);
    setError('');
    setMetrics([]);
    setRows([]);
    const call = screen === 'dashboard'
      ? fetchMetrics(session.accessToken, controller.signal).then(setMetrics)
      : fetchList(MODULES[screen].endpoint!, session.accessToken, controller.signal).then(setRows);
    call.catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) {
        onLogout();
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Chargement impossible.');
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [session, screen, role, preview, reloadKey, onLogout]);

  const navigate = (page: ModuleId) => {
    if (!canView(role, page)) return;
    setScreen(page);
    setMenuOpen(false);
  };
  const action = <button className="icon-button refresh-button" type="button"
      disabled={preview || busy} onClick={() => setReloadKey(current => current + 1)}
      title={preview ? 'Indisponible en aperçu' : 'Actualiser'} aria-label="Actualiser">
      <RefreshCw size={19}/></button>;
  return <div className="workspace">
    <aside className="sidebar">
      <Brand />
      <div className="sidebar-heading">ESPACE DE TRAVAIL <span>{ROLE_LABELS[role]}</span></div>
      <nav className="sidebar-navigation" aria-label="Navigation principale">
        {allowed.map(id => {
          const item = MODULES[id]; const Icon = item.icon;
          return <button key={id} type="button" className={'nav-link ' + (screen === id ? 'is-active' : '')}
            onClick={() => navigate(id)} aria-current={screen === id ? 'page' : undefined}>
            <Icon size={19}/><span>{item.label}</span>{screen === id && <ChevronRight size={15}/>}
          </button>;
        })}
      </nav>
      <div className="sidebar-footer">
        <span className="sidebar-dot"/><span>{preview ? 'Aperçu sans API' : 'Session sécurisée'}</span>
        <small>SMTR · Sinocet</small>
      </div>
    </aside>

    <div className="content-shell">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-button mobile-menu-button" aria-label="Tous les modules"
            aria-expanded={menuOpen} onClick={() => setMenuOpen(current => !current)}>
            {menuOpen ? <X size={21}/> : <Menu size={21}/>}
          </button>
          <div className="mobile-brand-shell"><Brand compact /></div>
          <div className="desktop-crumb">Sinocet <ChevronRight size={14}/> <strong>{nav.label}</strong></div>
        </div>
        <div className="topbar-right">
          <span className={'connection-status ' + (online ? 'online' : 'offline')}><span/> {online ? 'Connecté au réseau' : 'Hors ligne'}</span>
          <button className="profile-pill" type="button" onClick={onLogout} title="Se déconnecter / fermer l’aperçu">
            <span className="avatar">{(session?.user.name || ROLE_LABELS[role]).slice(0,1).toUpperCase()}</span>
            <span className="profile-name">{session?.user.name || ROLE_LABELS[role]}</span>
            <LogOut size={17}/>
          </button>
        </div>
      </header>

      {menuOpen && <nav className="mobile-drawer" aria-label="Tous les modules">
        {allowed.map(id => {const item=MODULES[id];const Icon=item.icon;return <button key={id}
          type="button" className={'drawer-link '+(screen===id?'is-active':'')} onClick={()=>navigate(id)}>
          <Icon size={19}/>{item.label}<ChevronRight size={16}/></button>;})}
      </nav>}

      <main className="workspace-main" id="main-content">
        {preview && <div className="preview-banner" role="status"><Shield size={17}/> Aperçu de l’interface uniquement : aucune connexion, aucune donnée réelle, aucune opération possible.</div>}
        {!online && <div className="offline-banner" role="alert"><AlertCircle size={17}/> Réseau indisponible. Aucune vente hors ligne n’est encore activée.</div>}
        <div className="page-overline"><span className="eyebrow-dark">SMTR / {ROLE_LABELS[role].toUpperCase()}</span><span>Groupe Sinocet Electronics</span></div>
        <div className="page-heading">
          <div><h1>{nav.title}</h1><p>{nav.description}</p></div>
          {action}
        </div>

        {screen === 'dashboard' && <section className="welcome-card">
          <div><span className="welcome-eyebrow">CENTRE DE PILOTAGE</span>
            <h2>{role === 'agent' ? 'Votre activité, à portée de main.' : 'Toutes vos opérations. Une vue claire.'}</h2>
            <p>Les informations affichées dépendent exclusivement des données autorisées par le serveur.</p>
          </div>
          <span className="welcome-decoration" aria-hidden="true"><Activity size={76} strokeWidth={1.4}/></span>
        </section>}

        {(screen === 'stocks' || screen === 'transfers') && <Operations
          screen={screen} role={role} token={session?.accessToken ?? null} preview={preview}
          onLogout={onLogout} onNavigate={navigate} />}
        {screen !== 'stocks' && screen !== 'transfers' && <section className="workspace-section" aria-live="polite">
          <div className="section-title">
            <div><span className="section-kicker">DONNÉES MÉTIER</span><h2>{screen === 'dashboard' ? 'Indicateurs' : 'Éléments disponibles'}</h2></div>
            <span className="section-tag">{preview ? 'APERÇU' : 'API'}</span>
          </div>
          {error && !preview && <div className="load-error" role="alert"><AlertCircle size={20}/>
            <div><strong>Chargement impossible</strong><p>{error}</p></div>
            <button type="button" onClick={() => setReloadKey(n => n + 1)}>Réessayer</button>
          </div>}
          {!error && screen === 'dashboard' && <MetricsView metrics={preview ? [] : metrics} loading={busy}/>}
          {!error && screen !== 'dashboard' && (busy
            ? <div className="loading" role="status"><LoaderCircle className="spin"/> Chargement des éléments…</div>
            : rows.length ? <ul className="records-list">{rows.map(row => <StatusRow key={row.id} row={row}/>)}</ul>
            : <EmptyState title="Aucune donnée à afficher"
                description={preview ? 'Cet aperçu montre les écrans sans inventer de ventes, de clients ou de stock.' : 'Aucun élément n’a été renvoyé par le serveur pour votre périmètre.'}/>
          )}
        </section>}

        <div className="scope-note">
          <span><Shield size={17}/></span>
          <p>Les habilitations, les stocks vendables, les limites de crédit et les validations doivent être contrôlés par l’API. La navigation seule ne donne aucun droit.</p>
        </div>
      </main>
      <footer className="app-footer"><span>SMTR · Sinocet Electronics</span><span>Version initiale · Mobile First</span></footer>
    </div>

    <nav className="bottom-navigation" aria-label="Navigation rapide mobile">
      {bottomNav.filter(id => canView(role,id)).map(id => {
        const item = MODULES[id];const Icon=item.icon;
        return <button key={id} type="button" aria-current={screen===id?'page':undefined}
          className={'bottom-link '+(screen===id?'is-active':'')} onClick={()=>navigate(id)}>
          <Icon size={22} strokeWidth={screen===id?2.4:1.9}/><small>{item.label}</small>
        </button>;
      })}
    </nav>
  </div>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const previewRole = getPreviewRole();
  const logout = useMemo(() => () => {
    if (session) void logoutRemote(session.accessToken).catch(() => undefined);
    setSession(null);
    if (previewRole) window.location.assign(window.location.pathname);
  }, [previewRole, session]);
  return session || previewRole
    ? <Workspace session={session} previewRole={previewRole} onLogout={logout}/>
    : <Login onSuccess={setSession}/>;
}
