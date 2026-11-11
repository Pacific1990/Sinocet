import {useMemo,useState,type FormEvent} from 'react';
import {AlertCircle,ArrowLeft,CheckCircle2,ClipboardList,ExternalLink,GitBranch,
  LayoutGrid,List,Play,ShieldCheck,SquarePen,TestTube2,TriangleAlert} from 'lucide-react';
import {Loading,Notice,Panel,SmallButton,Status} from './CatalogueUI';
import {useRemote} from './CatalogueUI';
import {displayError,patch,post} from './services';
import type {Role} from './permissions';
import './qa.css';

type QaStatus='todo'|'running'|'blocked'|'failed'|'ready'|'validated';
type QaEnvironment=''|'dev'|'prod';
type QaTool='manual'|'playwright';
type QaTemplate={key:string;role:Role;module:string;scenario:string;tool:QaTool;testData:string;expected:string};
type QaCase={
  id:string;templateKey:string;role:Role;module:string;scenario:string;testData:string;
  expectedResult:string;obtainedResult:string;status:QaStatus;bugRef:string;
  evidenceUrl:string;branchPr:string;commitSha:string;environment:QaEnvironment;
  nextAction:string;accountRef:string;executionTool:QaTool;
};
type View='dashboard'|'table'|'kanban'|'playwright'|'blockers'|'ready'|'templates'|'detail';
type Props={
  token:string|null;preview:boolean;role:Role;refresh:number;
  onLogout:()=>void;onRefresh:()=>void;
};
const ROLES:Role[]=['admin','director','manager','agent'];
const ROLE_TEXT:Record<Role,string>={admin:'Administrateur',director:'Direction',manager:'Manager',agent:'Agent'};
const STATUS_TEXT:Record<QaStatus,string>={
  todo:'À tester',running:'En cours',blocked:'Bloqué',failed:'Échec',
  ready:'Prêt à valider',validated:'Validé',
};
const STATUSES=Object.keys(STATUS_TEXT) as QaStatus[];
const statusColor=(status:QaStatus):'green'|'orange'|'red'|'purple'=>
  status==='validated'?'green':status==='ready'?'purple':
  status==='blocked'||status==='failed'?'red':'orange';
const scopedRoles=(role:Role)=>ROLES.slice(ROLES.indexOf(role));
const evidenceOk=(c:QaCase)=>Boolean(c.obtainedResult.trim()&&c.evidenceUrl.trim()&&c.environment);
export function statusNeedsDetail(c:QaCase,next:QaStatus,role:Role):boolean{
  if(next==='validated'&&(!['admin','director'].includes(role)||c.status!=='ready'))return true;
  return (next==='ready'||next==='validated')&&!evidenceOk(c)
    ||(next==='failed'||next==='blocked')&&!c.nextAction.trim()&&!c.bugRef.trim();
}
const emptyForm:QaCase={
  id:'',templateKey:'',role:'agent',module:'',scenario:'',testData:'',expectedResult:'',
  obtainedResult:'',status:'todo',bugRef:'',evidenceUrl:'',branchPr:'',commitSha:'',
  environment:'',nextAction:'',accountRef:'',executionTool:'manual',
};
const NAV:{id:Exclude<View,'detail'>;title:string;icon:typeof ClipboardList}[]=[
  {id:'dashboard',title:'Vue générale',icon:LayoutGrid},
  {id:'table',title:'Tableau',icon:List},
  {id:'kanban',title:'Kanban',icon:ClipboardList},
  {id:'playwright',title:'Playwright / comptes',icon:TestTube2},
  {id:'blockers',title:'Blocages',icon:TriangleAlert},
  {id:'ready',title:'À valider',icon:CheckCircle2},
  {id:'templates',title:'Modèles de parcours',icon:SquarePen},
];
function SafeEvidence({url}:{url:string}){
  if(!/^https?:\/\/[^@\s]+$/i.test(url))return <span>—</span>;
  return <a target="_blank" rel="noopener noreferrer" href={url} className="qa-link">
    Preuve <ExternalLink size={13}/></a>;
}
function CaseStatus({value}:{value:QaStatus}){
  return <Status label={STATUS_TEXT[value]} type={statusColor(value)}/>;
}
export default function QaPage(props:Props){
  const casesRemote=useRemote<{cases:QaCase[]}>(props.token,'/qa/cases',props.refresh,props.onLogout);
  const templatesRemote=useRemote<{templates:QaTemplate[]}>(props.token,'/qa/templates',props.refresh,props.onLogout);
  const cases=casesRemote.data?.cases||[];
  const templates=templatesRemote.data?.templates||[];
  const [view,setView]=useState<View>('dashboard');
  const [selected,setSelected]=useState('');
  const [draft,setDraft]=useState<QaCase>(emptyForm);
  const [roleFilter,setRoleFilter]=useState('all');
  const [environmentFilter,setEnvironmentFilter]=useState('all');
  const [moduleFilter,setModuleFilter]=useState('all');
  const [search,setSearch]=useState('');
  const [busyId,setBusyId]=useState('');
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [detailHelp,setDetailHelp]=useState('');
  const visibleRoles=scopedRoles(props.role);
  const modules=useMemo(()=>[...new Set(cases.map(c=>c.module))].sort(),[cases]);
  const filtered=useMemo(()=>cases.filter(c=>
    (roleFilter==='all'||c.role===roleFilter)&&
    (environmentFilter==='all'||c.environment===environmentFilter)&&
    (moduleFilter==='all'||c.module===moduleFilter)&&
    (c.scenario+' '+c.module+' '+c.accountRef+' '+c.branchPr+' '+c.bugRef)
      .toLocaleLowerCase('fr-FR').includes(search.toLocaleLowerCase('fr-FR'))
  ),[cases,roleFilter,environmentFilter,moduleFilter,search]);
  const metrics=useMemo(()=>({
    total:cases.length,blocked:cases.filter(c=>c.status==='blocked'||c.status==='failed').length,
    ready:cases.filter(c=>c.status==='ready').length,validated:cases.filter(c=>c.status==='validated').length,
    pending:cases.filter(c=>c.status==='todo').length,
  }),[cases]);
  const selectedCase=cases.find(c=>c.id===selected);
  function navigate(next:View){setError('');setDetailHelp('');setView(next);}
  function openDetail(c:QaCase,help=''){
    setSelected(c.id);setDraft({...c});setDetailHelp(help);setError('');setView('detail');
  }
  function updateDraft<K extends keyof QaCase>(key:K,value:QaCase[K]){
    setDraft(previous=>({...previous,[key]:value}));
  }
  async function makeCase(t:QaTemplate){
    if(!props.token||busyId)return;
    setBusyId(t.key);setError('');setNotice('');
    try{
      const created=await post<{caseId:string}>('/qa/cases',props.token,{templateKey:t.key});
      casesRemote.reload();props.onRefresh();
      setNotice('Parcours créé à l’état « À tester ». Aucun résultat n’est présumé.');
      setSelected(created.caseId);setView('table');
    }catch(e){setError(displayError(e,props.onLogout));}
    finally{setBusyId('');}
  }
  async function quickStatus(c:QaCase,status:QaStatus){
    if(status===c.status)return;
    if(status==='validated'&&!['admin','director'].includes(props.role)){
      openDetail(c,'La validation finale est réservée à la Direction ou à l’Administrateur.');
      return;
    }
    if(statusNeedsDetail(c,status,props.role)){
      openDetail({...c,status},'Renseignez les preuves, le résultat ou la prochaine action avant de changer ce statut.');
      return;
    }
    if(!props.token||busyId)return;
    setBusyId(c.id);setError('');setNotice('');
    try{
      await patch('/qa/cases/'+c.id,props.token,{status});
      casesRemote.reload();props.onRefresh();
      setNotice('Statut mis à jour et tracé.');
    }catch(e){setError(displayError(e,props.onLogout));}
    finally{setBusyId('');}
  }
  async function saveDetail(event:FormEvent){
    event.preventDefault();
    if(!props.token||!selectedCase||busyId)return;
    setBusyId(selected);setError('');setNotice('');
    try{
      await patch('/qa/cases/'+selected,props.token,{
        testData:draft.testData,expectedResult:draft.expectedResult,
        obtainedResult:draft.obtainedResult,status:draft.status,bugRef:draft.bugRef,
        evidenceUrl:draft.evidenceUrl,branchPr:draft.branchPr,commitSha:draft.commitSha,
        environment:draft.environment,nextAction:draft.nextAction,accountRef:draft.accountRef,
      });
      casesRemote.reload();props.onRefresh();setView('table');setDetailHelp('');
      setNotice('Parcours enregistré. Le résultat n’est validé que si son statut l’indique.');
    }catch(e){setError(displayError(e,props.onLogout));}
    finally{setBusyId('');}
  }
  function StatusEditor({c}:{c:QaCase}){
    return <select className="qa-status-select" aria-label={'Changer le statut de '+c.scenario}
      value={c.status} disabled={!!busyId} onChange={e=>void quickStatus(c,e.target.value as QaStatus)}>
      {STATUSES.map(x=><option key={x} value={x}
        disabled={x==='validated'&&!['admin','director'].includes(props.role)}>{STATUS_TEXT[x]}</option>)}
    </select>;
  }
  const views=(()=>{
    if(view==='dashboard')return <>
      <section className="qa-metrics" aria-label="Indicateurs de validation">
        {[
          {label:'Parcours enregistrés',value:metrics.total},
          {label:'À tester',value:metrics.pending},
          {label:'Blocages et échecs',value:metrics.blocked},
          {label:'Prêts à valider',value:metrics.ready},
          {label:'Validés',value:metrics.validated},
        ].map(m=><div className="qa-metric" key={m.label}>
          <span>{m.label}</span><strong>{m.value}</strong>
        </div>)}
      </section>
      <div className="qa-dashboard-grid">
        <Panel title="Suivi par rôle" subtitle="Le périmètre est vérifié par l’API, pas seulement par l’écran.">
          <div className="qa-role-grid">
            {visibleRoles.map(role=>{
              const data=cases.filter(c=>c.role===role);
              return <button className="qa-role" key={role} type="button"
                onClick={()=>{setRoleFilter(role);navigate('table');}}>
                <span>{ROLE_TEXT[role]}</span>
                <strong>{data.filter(c=>c.status==='validated').length} / {data.length}</strong>
                <small>validés / enregistrés</small>
              </button>;
            })}
          </div>
        </Panel>
        <Panel title="Points d’attention" subtitle="Les modèles non exécutés ne sont pas comptés comme des réussites.">
          <div className="qa-summary-actions">
            <button type="button" onClick={()=>navigate('blockers')}>
              <TriangleAlert size={20}/> <strong>{metrics.blocked}</strong><span>blocages ou échecs</span></button>
            <button type="button" onClick={()=>navigate('ready')}>
              <ShieldCheck size={20}/> <strong>{metrics.ready}</strong><span>parcours à valider</span></button>
            <button type="button" onClick={()=>navigate('playwright')}>
              <Play size={20}/><strong>{cases.filter(c=>c.executionTool==='playwright').length}</strong>
              <span>parcours Playwright suivis</span></button>
          </div>
        </Panel>
      </div>
      <Panel title="Démarrer ou reprendre la recette"
        subtitle="Instanciez un scénario réel depuis les modèles, puis renseignez l’exécution.">
        <div className="qa-start">
          <button type="button" onClick={()=>navigate('templates')}>
            <SquarePen size={18}/> Ajouter un parcours depuis un modèle</button>
          <button type="button" onClick={()=>navigate('table')}>
            <List size={18}/> Ouvrir le tableau des résultats</button>
          <button type="button" onClick={()=>navigate('kanban')}>
            <LayoutGrid size={18}/> Visualiser le kanban</button>
        </div>
      </Panel>
    </>;
    if(view==='templates')return <Panel title="Modèles réutilisables"
      subtitle="Scénarios existants dans SMTR. Leur création n’est pas une preuve d’exécution.">
      <div className="qa-template-grid">{templates.filter(t=>roleFilter==='all'||t.role===roleFilter).map(t=>
        <article className="qa-template" key={t.key}>
          <div className="qa-template-tags"><span>{ROLE_TEXT[t.role]}</span>
            <span>{t.module}</span><span>{t.tool==='playwright'?'Playwright':'Manuel'}</span></div>
          <h3>{t.scenario}</h3>
          <p><strong>Données :</strong> {t.testData}</p>
          <p><strong>Attendu :</strong> {t.expected}</p>
          <SmallButton kind="blue" disabled={!!busyId} onClick={()=>void makeCase(t)}>
            {busyId===t.key?'Création…':'Créer une fiche à tester'}</SmallButton>
        </article>)}
      </div>
      {!templates.length&&<p>Modèles indisponibles pour ce compte.</p>}
    </Panel>;
    if(view==='playwright'){
      const automated=filtered.filter(c=>c.executionTool==='playwright');
      const accounts=[...new Set(automated.map(c=>c.accountRef.trim()||'Compte à renseigner'))];
      return <Panel title="Tests Playwright par compte"
        subtitle="Chaque ligne représente un suivi de test, pas une exécution automatique. Les captures et rapports doivent être joints après exécution.">
        <p className="qa-hint"><TestTube2 size={17}/> Ne consignez jamais un mot de passe, un jeton de session ou un code OTP dans les données de test.</p>
        {!automated.length?<p className="qa-empty">Aucun parcours Playwright enregistré. Utilisez les modèles de parcours pour commencer.</p>:
          accounts.map(account=><div className="qa-account-group" key={account}>
            <h3>{account} <small>{automated.filter(c=>(c.accountRef.trim()||'Compte à renseigner')===account).length} test(s)</small></h3>
            <div className="qa-card-grid">
              {automated.filter(c=>(c.accountRef.trim()||'Compte à renseigner')===account).map(c=>
                <article className="qa-case-card" key={c.id}>
                  <div className="qa-card-top"><span>{ROLE_TEXT[c.role]} · {c.module}</span><CaseStatus value={c.status}/></div>
                  <strong>{c.scenario}</strong>
                  <div className="qa-card-meta"><span>{c.environment?c.environment.toUpperCase():'Environnement à renseigner'}</span>
                    <SafeEvidence url={c.evidenceUrl}/></div>
                  <div className="qa-card-actions"><StatusEditor c={c}/>
                    <SmallButton onClick={()=>openDetail(c)}>Détails</SmallButton></div>
                </article>)}
            </div>
          </div>)}
      </Panel>;
    }
    if(view==='kanban')return <Panel title="Kanban de validation"
      subtitle="Changez le statut depuis chaque carte. Sur mobile, faites défiler les colonnes horizontalement.">
      <div className="qa-board">
        {STATUSES.map(status=>{
          const cards=filtered.filter(c=>c.status===status);
          return <section className="qa-lane" key={status}>
            <h3><span>{STATUS_TEXT[status]}</span><small>{cards.length}</small></h3>
            <div className="qa-lane-cards">
              {cards.map(c=><article className="qa-case-card" key={c.id}>
                <div className="qa-card-top"><span>{ROLE_TEXT[c.role]} · {c.module}</span></div>
                <strong>{c.scenario}</strong>
                <p>{c.nextAction||'Prochaine action non renseignée'}</p>
                <div className="qa-card-meta">
                  <span>{c.executionTool==='playwright'?'Playwright':'Manuel'}</span>
                  <span>{c.environment||'—'}</span></div>
                <div className="qa-card-actions"><StatusEditor c={c}/>
                  <SmallButton onClick={()=>openDetail(c)}>Ouvrir</SmallButton></div>
              </article>)}
              {!cards.length&&<p className="qa-lane-empty">Aucun parcours</p>}
            </div>
          </section>;
        })}
      </div>
    </Panel>;
    const viewCases=view==='blockers'?filtered.filter(c=>c.status==='blocked'||c.status==='failed'):
      view==='ready'?filtered.filter(c=>c.status==='ready'):filtered;
    const labels=view==='blockers'?{title:'Blocages et échecs',description:'Bug, preuve et prochaine action à traiter.'}:
      view==='ready'?{title:'Prêts pour validation',description:'Vérifier les preuves avant validation finale.'}:
      {title:'Tableau des parcours',description:'Statuts modifiables en ligne ; ouvrez une fiche pour documenter les résultats.'};
    return <Panel title={labels.title} subtitle={labels.description}>
      <div className="qa-table-wrap"><table className="qa-table">
        <thead><tr><th>Rôle / module</th><th>Parcours et compte</th>
          <th>Données de test</th><th>Résultat attendu</th><th>Résultat obtenu</th>
          <th>Statut</th><th>Bug / preuve</th><th>Branche / PR</th><th>Commit</th>
          <th>Environnement</th><th>Prochaine action</th><th>Ouvrir</th></tr></thead>
        <tbody>{viewCases.map(c=><tr key={c.id}>
          <td><b>{ROLE_TEXT[c.role]}</b><small>{c.module}</small></td>
          <td><strong>{c.scenario}</strong><small>{c.accountRef||'Compte non renseigné'} · {c.executionTool}</small></td>
          <td className="qa-long-cell">{c.testData}</td>
          <td className="qa-long-cell">{c.expectedResult}</td>
          <td className="qa-long-cell">{c.obtainedResult||'Non renseigné'}</td>
          <td><StatusEditor c={c}/></td>
          <td><small>{c.bugRef||'—'}</small><SafeEvidence url={c.evidenceUrl}/></td>
          <td><small>{c.branchPr||'—'}</small></td>
          <td><code>{c.commitSha?c.commitSha.slice(0,12):'—'}</code></td>
          <td>{c.environment?c.environment.toUpperCase():'—'}</td>
          <td className="qa-long-cell">{c.nextAction||'Non renseignée'}</td>
          <td><SmallButton onClick={()=>openDetail(c)}>Détails</SmallButton></td>
        </tr>)}</tbody>
      </table></div>
      {!viewCases.length&&<p className="qa-empty">Aucun parcours correspondant. Les modèles permettent de préparer la recette sans inventer de résultats.</p>}
    </Panel>;
  })();

  if(props.preview)return <Panel title="Validation et recette"
    subtitle="Aperçu de l’espace de validation par rôle.">
    <Notice>Mode aperçu sans données : aucune exécution, preuve ni statut n’est simulé.</Notice>
  </Panel>;
  if(view==='detail')return <div className="qa-root">
    <div className="qa-detail-toolbar">
      <SmallButton onClick={()=>navigate('table')}><ArrowLeft size={15}/> Retour au tableau</SmallButton>
      <span><ShieldCheck size={16}/> Édition tracée sur le serveur POS</span>
    </div>
    {error&&<Notice tone="error">{error}</Notice>}
    {detailHelp&&<Notice>{detailHelp}</Notice>}
    {!selectedCase?<Panel title="Parcours introuvable"><p>Actualisez la liste des parcours.</p></Panel>:
      <Panel title={selectedCase.scenario}
        subtitle={ROLE_TEXT[selectedCase.role]+' · '+selectedCase.module+' · '+selectedCase.executionTool}>
        <form className="qa-detail-form" onSubmit={saveDetail}>
          <div className="qa-form-grid">
            <label>Compte de test (identifiant, jamais mot de passe)
              <input maxLength={190} value={draft.accountRef}
                onChange={e=>updateDraft('accountRef',e.target.value)}
                placeholder="Identifiant du compte de recette"/></label>
            <label>Environnement
              <select value={draft.environment} onChange={e=>updateDraft('environment',e.target.value as QaEnvironment)}>
                <option value="">Non renseigné</option><option value="dev">Développement</option><option value="prod">Production</option>
              </select></label>
            <label>Branche ou PR
              <input maxLength={250} value={draft.branchPr} onChange={e=>updateDraft('branchPr',e.target.value)}
                placeholder="Nom de branche ou URL de PR"/></label>
            <label>Commit (SHA)
              <input maxLength={40} value={draft.commitSha} onChange={e=>updateDraft('commitSha',e.target.value)}
                placeholder="SHA réel, si connu"/></label>
            <label>Statut
              <select value={draft.status} onChange={e=>updateDraft('status',e.target.value as QaStatus)}>
                {STATUSES.map(x=><option key={x} value={x}
                  disabled={x==='validated'&&!['admin','director'].includes(props.role)}>
                  {STATUS_TEXT[x]}</option>)}
              </select></label>
            <label>Bug / ticket
              <input maxLength={500} value={draft.bugRef} onChange={e=>updateDraft('bugRef',e.target.value)}
                placeholder="Lien ou référence du bug"/></label>
          </div>
          <div className="qa-form-grid qa-form-grid-wide">
            <label>Données de test
              <textarea rows={4} maxLength={3000} required value={draft.testData}
                onChange={e=>updateDraft('testData',e.target.value)}/></label>
            <label>Résultat attendu
              <textarea rows={4} maxLength={3000} required value={draft.expectedResult}
                onChange={e=>updateDraft('expectedResult',e.target.value)}/></label>
            <label>Résultat obtenu
              <textarea rows={4} maxLength={3000} value={draft.obtainedResult}
                onChange={e=>updateDraft('obtainedResult',e.target.value)}
                placeholder="Décrivez uniquement ce qui a réellement été observé."/></label>
            <label>Prochaine action
              <textarea rows={4} maxLength={3000} value={draft.nextAction}
                onChange={e=>updateDraft('nextAction',e.target.value)}
                placeholder="Correction, vérification ou validation à effectuer."/></label>
          </div>
          <label className="qa-evidence-field">Capture ou lien de preuve (URL HTTP/HTTPS)
            <input type="url" maxLength={1000} value={draft.evidenceUrl}
              onChange={e=>updateDraft('evidenceUrl',e.target.value)}
              placeholder="https://... lien d'un rapport Playwright, capture ou PR"/></label>
          <p className="qa-hint"><AlertCircle size={16}/>
            « Prêt à valider » et « Validé » exigent le résultat obtenu, une preuve et l’environnement.
            « Bloqué » ou « Échec » exigent un bug ou une prochaine action.
            « Validé » n’est autorisé qu’après « Prêt à valider » par la Direction ou l’Administrateur.</p>
          <div className="qa-form-actions">
            <SmallButton onClick={()=>navigate('table')}>Annuler</SmallButton>
            <button className="qa-primary" type="submit" disabled={!!busyId}>
              {busyId?'Enregistrement…':'Enregistrer ce parcours'}</button>
          </div>
        </form>
      </Panel>}
  </div>;
  return <div className="qa-root">
    <div className="qa-header">
      <div><div className="qa-kicker"><ShieldCheck size={16}/> Cockpit de recette SMTR</div>
        <p>Parcours réels, preuves, décisions et suivi des corrections. Aucune validation automatique.</p></div>
      <button type="button" className="qa-primary" onClick={()=>navigate('templates')}>
        <SquarePen size={16}/> Nouveau parcours</button>
    </div>
    {notice&&<Notice tone="success">{notice}</Notice>}
    {(error||casesRemote.error||templatesRemote.error)&&<Notice tone="error">
      {error||casesRemote.error||templatesRemote.error}</Notice>}
    <nav className="qa-tabs" aria-label="Vues de validation">
      {NAV.map(t=>{const Icon=t.icon;return <button type="button" key={t.id}
        className={view===t.id?'is-active':''} aria-current={view===t.id?'page':undefined}
        onClick={()=>navigate(t.id)}><Icon size={17}/><span>{t.title}</span></button>;})}
    </nav>
    <div className="qa-filters">
      <label>Rôle
        <select value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}>
          <option value="all">Tous les rôles visibles</option>
          {visibleRoles.map(r=><option value={r} key={r}>{ROLE_TEXT[r]}</option>)}
        </select></label>
      <label>Environnement
        <select value={environmentFilter} onChange={e=>setEnvironmentFilter(e.target.value)}>
          <option value="all">Tous</option><option value="">Non renseigné</option>
          <option value="dev">DEV</option><option value="prod">PROD</option>
        </select></label>
      <label>Module
        <select value={moduleFilter} onChange={e=>setModuleFilter(e.target.value)}>
          <option value="all">Tous les modules</option>
          {modules.map(m=><option value={m} key={m}>{m}</option>)}
        </select></label>
      <label>Rechercher
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Parcours, bug, compte, branche…"/></label>
    </div>
    {casesRemote.loading||templatesRemote.loading?<Loading/>:views}
    <p className="qa-bottom-note"><GitBranch size={15}/>
      Une branche, une PR ou un commit renseigné n’atteste pas d’un test réussi.
      Le statut « Validé » résulte uniquement d’une validation explicite et tracée.</p>
  </div>;
}
