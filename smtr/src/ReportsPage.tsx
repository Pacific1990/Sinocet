import { useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { Empty, Field, Filters, Loading, Notice, Panel, SmallButton, useRemote } from './CatalogueUI';
import { displayError, exportFile } from './services';
type Report={id:string;name:string;frequency:string;formats:string[]};
type Props={token:string|null;preview:boolean;refresh:number;onLogout:()=>void};

const info:Record<string,string>={
  stock_variance:'Stock initial vs réel, écarts documentés après inventaires.',
  sav_monthly:'Appareils Ramba, défauts et solutions prises pendant la période.',
  sales:'Ventes et chiffre d’affaires déclarés par agents et produits.',
  debts:'Créances clients, échéances et soldes restant à régulariser.',
};
export default function ReportsPage(props:Props){
  const reports=useRemote<{reports:Report[]}>(props.token,'/reports',props.refresh,props.onLogout);
  const today=new Date().toISOString().slice(0,10);
  const [from,setFrom]=useState(today.slice(0,7)+'-01');
  const [to,setTo]=useState(today);
  const [format,setFormat]=useState<'pdf'|'xlsx'>('pdf');
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  async function download(report:Report,selectedFormat:'pdf'|'xlsx'){
    if(!props.token||busy)return;
    setBusy(report.id);setError('');setMessage('');
    try{
      const params=new URLSearchParams({format:selectedFormat,from,to});
      await exportFile('/reports/'+report.id+'?'+params,props.token,
        'smtr-'+report.id+'-'+from+'-'+to+'.'+selectedFormat);
      setMessage('Export '+report.name+' généré.');
    }catch(e){setError(displayError(e,props.onLogout));}finally{setBusy('');}
  }
  if(props.preview)return <Panel title="Rapports & exports">
    <Empty>Connectez-vous pour exporter les données de votre entreprise.</Empty>
  </Panel>;
  return <div className="smtr-ref">
    {error&&<Notice tone="error">{error}</Notice>}
    {reports.error&&<Notice tone="error">{reports.error}</Notice>}
    {message&&<Notice tone="success">{message}</Notice>}
    <Panel title="Rapports & exports" subtitle="Générez les tableaux PDF ou Excel des données réellement enregistrées">
      <Filters>
        <Field label="Du"><input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)}/></Field>
        <Field label="Au"><input type="date" value={to} min={from} onChange={e=>setTo(e.target.value)}/></Field>
        <Field label="Format privilégié">
          <select value={format} onChange={e=>setFormat(e.target.value as 'pdf'|'xlsx')}>
            <option value="pdf">PDF</option><option value="xlsx">Excel</option>
          </select>
        </Field>
      </Filters>
      {reports.loading?<Loading/>:<div className="catalog-grid">
        {(reports.data?.reports||[]).map(report=><article className="catalog-report-card" key={report.id}>
          <span className="catalog-inline-chip">{report.frequency}</span>
          <h3>{report.name}</h3>
          <p>{info[report.id]||'Rapport SMTR'}</p>
          <div className="catalog-actions">
            <SmallButton kind="blue" disabled={Boolean(busy)||!from||!to||from>to}
              onClick={()=>download(report,format)}>
              <Download size={16}/> {busy===report.id?'Export…':'Télécharger '+format.toUpperCase()}
            </SmallButton>
            <SmallButton disabled={Boolean(busy)} onClick={()=>download(report,format==='pdf'?'xlsx':'pdf')}>
              {format==='pdf'?<FileSpreadsheet size={16}/>:<FileText size={16}/>}
              {format==='pdf'?'Excel':'PDF'}
            </SmallButton>
          </div>
        </article>)}
      </div>}
      <p className="catalog-note">Les exports respectent les autorisations de consultation du serveur. Ils ne contiennent que les lignes de la période sélectionnée et ont une limite de 5 000 lignes par document.</p>
    </Panel>
  </div>;
}
