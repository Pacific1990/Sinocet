import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle, PackageSearch } from 'lucide-react';
import { displayError, get } from './services';
export const ApplicationSettings=createContext({companyName:'Groupe Sinocet Electronics',pageSize:25});

export function useRemote<T>(token:string|null,path:string,refresh:number,onLogout:()=>void){
  const [data,setData]=useState<T|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [reload,setReload]=useState(0);
  useEffect(()=>{
    if(!token||!path){setData(null);return;}
    let active=true;const controller=new AbortController();
    setLoading(true);setError('');
    get<T>(path,token,controller.signal).then(result=>{if(active)setData(result);})
      .catch(cause=>{if(active)setError(displayError(cause,onLogout));})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;controller.abort();};
  },[token,path,refresh,reload,onLogout]);
  return {data,loading,error,reload:()=>setReload(x=>x+1)};
}
export function Notice({children,tone='warning'}:{
  children:ReactNode;tone?:'warning'|'error'|'success'
}){
  return <div className={'ref-notice ref-notice--'+tone} role={tone==='error'?'alert':'status'}>
    {tone==='success'?<CheckCircle2 size={18}/>:<AlertCircle size={18}/>}
    <span>{children}</span>
  </div>;
}
export function Loading(){
  return <div className="ref-loading" role="status"><LoaderCircle className="spin" size={19}/> Chargement…</div>;
}
export function Empty({children}:{children:ReactNode}){
  return <div className="ref-empty"><PackageSearch size={20}/><span>{children}</span></div>;
}
export function Panel({title,subtitle,action,children,className=''}:{
  title?:string;subtitle?:string;action?:ReactNode;children:ReactNode;className?:string;
}){
  return <section className={'ref-panel '+className}>
    {(title||action)&&<header className="ref-panel-head">
      <div>{title&&<h2>{title}</h2>}{subtitle&&<p>{subtitle}</p>}</div>
      {action&&<div className="ref-actions">{action}</div>}
    </header>}
    {children}
  </section>;
}
export function DataTable({headers,rows,emptyMessage='Aucune donnée à afficher.'}:{
  headers:string[];rows:ReactNode[][];emptyMessage?:string
}){
  const {pageSize}=useContext(ApplicationSettings);
  const [page,setPage]=useState(0);
  const lastPage=Math.max(0,Math.ceil(rows.length/pageSize)-1);
  const current=Math.min(page,lastPage);
  const visible=rows.slice(current*pageSize,(current+1)*pageSize);
  if(!rows.length)return <Empty>{emptyMessage}</Empty>;
  return <><div className="ref-table-scroll"><table className="ref-table">
    <thead><tr>{headers.map((h,i)=><th key={i} scope="col">{h}</th>)}</tr></thead>
    <tbody>{visible.map((cells,i)=><tr key={i}>
      {cells.map((c,j)=><td key={j}>{c}</td>)}
    </tr>)}</tbody>
  </table></div>{lastPage>0&&<div className="catalog-actions" aria-label="Pagination"><button type="button" disabled={current===0} onClick={()=>setPage(current-1)}>Précédent</button><span>Page {current+1} / {lastPage+1}</span><button type="button" disabled={current===lastPage} onClick={()=>setPage(current+1)}>Suivant</button></div>}</>;
}
export function Status({label,type}:{label:string;type?:'green'|'orange'|'red'|'purple'}){
  const selected=type||( /reçu|conforme|résolu|payé|actif|suffisant|approuvé/i.test(label)?'green':
      /écart|refus|annul|dépass|gel|sous le seuil/i.test(label)?'red':'orange');
  return <span className={'ref-status ref-status--'+selected}>{label}</span>;
}
export function Metric({label,value,hint}:{label:string;value:string|number;hint?:string}){
  return <div className="ref-metric">
    <span>{label}</span><strong>{value}</strong>{hint&&<small>{hint}</small>}
  </div>;
}
export function SmallButton({children,onClick,disabled=false,kind='outline',type='button'}:{
  children:ReactNode;onClick?:()=>void;disabled?:boolean;
  kind?:'outline'|'blue'|'danger';type?:'submit'|'button';
}){
  return <button type={type} disabled={disabled} onClick={onClick}
    className={'ref-button ref-button--'+(kind==='danger'?'danger':kind)}>{children}</button>;
}
export function SubmitButton({children,disabled=false}:{children:ReactNode;disabled?:boolean}){
  return <button className="ref-button ref-button--blue" type="submit" disabled={disabled}>{children}</button>;
}
export function Field({label,children}:{label:string;children:ReactNode}){
  return <label className="catalog-field">{label}{children}</label>;
}
export function Filters({children}:{children:ReactNode}){
  return <div className="catalog-filters">{children}</div>;
}
export function SectionGrid({children}:{children:ReactNode}){
  return <div className="catalog-grid">{children}</div>;
}
