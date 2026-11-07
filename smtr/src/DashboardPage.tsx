import { ArrowLeftRight, ClipboardCheck, CreditCard, FileText, ShoppingBag, Wallet, Boxes, Shield } from 'lucide-react';
import { DataTable, Empty, Loading, Metric, Notice, Panel, useRemote } from './CatalogueUI';
import { fcfa } from './services';
import type { ModuleId,Role } from './permissions';
import type { StockCategory } from './api';

type MetricValue={id:string;label:string;value:string;hint?:string};
type Overview={ranking:Array<{id:string;name:string;salesCount:number;turnoverF:number;activeStock:number}>;alerts:Array<{id:string;kind:string;message:string;module:ModuleId}>};
type Props={role:Role;token:string|null;preview:boolean;onLogout:()=>void;onNavigate:(id:ModuleId)=>void;refresh:number};

export default function DashboardPage({role,token,preview,onLogout,onNavigate,refresh}:Props){
  const metrics=useRemote<{metrics:MetricValue[]}>(token,'/dashboard/summary',refresh,onLogout);
  const overview=useRemote<Overview>(token,'/dashboard/overview',refresh,onLogout);
  const stocks=useRemote<{categories:StockCategory[]}>(role==='agent'?token:null,'/stocks',refresh,onLogout);
  const info=overview.data;
  const cells=metrics.data?.metrics||[];
  const agent=role==='agent';
  const label=agent?'Tableau de bord Agent':role==='manager'?'Tableau de bord Manager':'Tableau de bord stratégique';
  if(preview)return <div className="smtr-ref catalog-phone-panel">
    <Panel title={label} subtitle="Présentation fidèle au catalogue, sans données simulées">
      <Empty>Authentifiez-vous pour afficher les indicateurs réels.</Empty>
    </Panel>
  </div>;
  return <div className={'smtr-ref '+(agent?'catalog-phone-panel':'')}>
    {(metrics.error||overview.error||stocks.error)&&<Notice tone="error">{metrics.error||overview.error||stocks.error}</Notice>}
    {(metrics.loading||overview.loading)&&!metrics.data?<Loading/>:null}
    <div className="catalog-metrics">
      {cells.map(m=><Metric key={m.id} label={m.label} value={m.value} hint={m.hint}/>)}
    </div>
    {agent&&<div className="catalog-inline-list">
      {info?.alerts.map(alert=><div key={alert.id} className={'catalog-alert catalog-alert--'+(alert.kind==='danger'?'danger':'warning')}>
        <span>{alert.message}</span><button className="catalog-link" type="button" onClick={()=>onNavigate(alert.module)}>Voir</button>
      </div>)}
      <div className="catalog-tiles">
        <button className="catalog-tile" type="button" onClick={()=>onNavigate('sales')}><ShoppingBag size={19}/> Nouvelle vente</button>
        <button className="catalog-tile" type="button" onClick={()=>onNavigate('transfers')}><ClipboardCheck size={19}/> Valider réception</button>
        <button className="catalog-tile" type="button" onClick={()=>onNavigate('debts')}><CreditCard size={19}/> Mes crédits</button>
        <button className="catalog-tile" type="button" onClick={()=>onNavigate('cash')}><Wallet size={19}/> Ma caisse</button>
      </div>
      <Panel title="Mon stock" subtitle="Disponibilité par catégorie, selon le stock réellement confié">
        {stocks.loading?<Loading/>:!stocks.data?.categories.length?<Empty>Aucun stock agent disponible.</Empty>:
          stocks.data.categories.map(c=>{
            const ratio=c.minimumLevel?Math.min(100,100*c.available/c.minimumLevel):100;
            return <div key={c.id}>
              <div className="catalog-row"><span>{c.name}</span><strong>{c.available} disponible(s)</strong></div>
              <div className={'catalog-stock-bar '+(ratio<100?'critical':'')}><span style={{width:ratio+'%'}}/></div>
            </div>;
          })
        }
      </Panel>
    </div>}

    {!agent&&<div className="catalog-grid--2">
      <Panel title={role==='director'?'Classement des agents — chiffre d’affaires du jour':'Transferts en cours'}
        subtitle={role==='director'?'Performances des agents et stock actif':'Activité de distribution vers les agents'}>
        {info?.ranking.length?
          <DataTable headers={['AGENT','CA DU JOUR','STOCK ACTIF','VENTES']} rows={
            info.ranking.map(x=>[x.name,fcfa(x.turnoverF),x.activeStock,x.salesCount])
          }/>:<Empty>Aucune activité d’agent à afficher.</Empty>}
        <div className="catalog-actions" style={{marginTop:16}}>
          <button className="ref-button ref-button--blue" type="button"
            onClick={()=>onNavigate(role==='manager'?'transfers':'supervision')}>
            {role==='manager'?'+ Nouveau transfert':'Voir la cartographie du stock'}
          </button>
          {role==='manager'&&<button className="ref-button ref-button--outline" type="button" onClick={()=>onNavigate('inventory')}>Geler un stock agent</button>}
        </div>
      </Panel>
      <div className="catalog-inline-list">
        <Panel title="Alertes">
          {!info?.alerts.length?<Empty>Aucune alerte métier active.</Empty>:
            info.alerts.map(alert=>
              <div key={alert.id} className={'catalog-alert catalog-alert--'+(alert.kind==='danger'?'danger':'warning')}>
                <span>{alert.message}</span>
                <button className="catalog-link" type="button" onClick={()=>onNavigate(alert.module)}>Voir</button>
              </div>)}
        </Panel>
        <Panel title="Accès rapide">
          <div className="catalog-inline-list">
            <button className="ref-button ref-button--outline" type="button"
              onClick={()=>onNavigate('supervision')}><Boxes size={17}/> Voir la cartographie du stock</button>
            <button className="ref-button ref-button--outline" type="button"
              onClick={()=>onNavigate(role==='manager'?'approvals':'audit')}><Shield size={17}/> {role==='manager'?'Valider une remise':'Journal d’audit'}</button>
            <button className="ref-button ref-button--outline" type="button"
              onClick={()=>onNavigate(role==='manager'?'inventory':'users')}><ArrowLeftRight size={17}/> {role==='manager'?'Inventaire tournant':'Gérer les plafonds de crédit'}</button>
            <button className="ref-button ref-button--outline" type="button"
              onClick={()=>onNavigate('reports')}><FileText size={17}/> Rapports & exports</button>
          </div>
        </Panel>
      </div>
    </div>}
  </div>;
}
