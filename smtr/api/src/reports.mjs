import { Router } from 'express';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { requireRole } from './auth.mjs';
import { assert, maskImei } from './errors.mjs';
import { businessDay, choice, dateValue, idOrFail } from './utils.mjs';

const BRAND='#111e3c', BLUE='#2d5ce3';
const localeNumber=n=>Number(n||0).toLocaleString('fr-FR');
const shortDate=value=>value?new Date(value).toLocaleDateString('fr-FR',{timeZone:'UTC'}):'—';
const safeCell=value=>{
  const t=value==null?'':String(value);
  return /^[=+\-@\t\r]/.test(t)?"'"+t:t;
};
const columns={
  sales:['Vente','Date','Agent','Client','Produit','IMEI','Montant (FCFA)','Payé (FCFA)','Crédit (FCFA)','État'],
  stock_variance:['Inventaire','Date','Agent','Produit','Stock initial','Stock réel','Écart'],
  sav_monthly:['Produit','Agent','Ventes période','Retours SAV période','Taux retours/ventes','SAV en cours'],
  debts:['Dette','Client','Agent','Montant initial (FCFA)','Reste dû (FCFA)','Échéance','Statut'],
};
const labels={
  sales:'Export des ventes',
  stock_variance:'Stock Initial vs Réel',
  sav_monthly:'Rapport SAV mensuel — retours / ventes de la période',
  debts:'Export des dettes et crédits',
};

async function getData(pool,kind,req){
  const agentFilter=req.query.agentId?idOrFail(req.query.agentId,'Agent'):null;
  const date=businessDay();
  const from=req.query.from?dateValue(req.query.from):date.slice(0,7)+'-01';
  const to=req.query.to?dateValue(req.query.to):date;
  assert(from<=to,422,'Période inversée.');
  const maxDays=(new Date(to+'T00:00:00Z')-new Date(from+'T00:00:00Z'))/86400000;
  assert(maxDays<=366,422,'Période limitée à un an.');
  const params=[from,to];
  let rows;
  if(kind==='sales'){
    const [data]=await pool.query(
      'SELECT s.id,s.created_at AS occurred,u.name AS agent,c.name AS customer,p.name AS product,'+
      'i.imei,s.total_amount_f,s.paid_amount_f,s.credit_amount_f,s.status '+
      'FROM sales s JOIN users u ON u.id=s.agent_user_id '+
      'LEFT JOIN customers c ON c.id=s.customer_id '+
      'JOIN items i ON i.id=s.item_id JOIN products p ON p.id=i.product_id '+
      'WHERE DATE(s.created_at) BETWEEN ? AND ? '+
      (agentFilter?'AND s.agent_user_id=? ':'')+
      'ORDER BY s.created_at DESC LIMIT 5000',agentFilter?[...params,agentFilter]:params
    );
    rows=data.map(r=>[r.id,shortDate(r.occurred),r.agent,r.customer||'Comptant',
      r.product,maskImei(r.imei),r.total_amount_f,r.paid_amount_f,r.credit_amount_f,r.status]);
  }else if(kind==='stock_variance'){
    const [data]=await pool.query(
      'SELECT v.id,v.finished_at AS occurred,u.name AS agent,p.name AS product,'+
      'il.expected_count,il.counted_count,(il.counted_count-il.expected_count) AS difference '+
      'FROM inventories v JOIN inventories_lines il ON il.inventory_id=v.id '+
      'JOIN products p ON p.id=il.product_id JOIN warehouses w ON w.id=v.warehouse_id '+
      'JOIN users u ON u.id=w.agent_user_id WHERE v.status=\'CLOSED\' AND DATE(v.finished_at) BETWEEN ? AND ? '+
      (agentFilter?'AND u.id=? ':'')+
      'ORDER BY v.finished_at DESC,u.name LIMIT 5000',agentFilter?[...params,agentFilter]:params
    );
    rows=data.map(r=>[r.id,shortDate(r.occurred),r.agent,r.product,r.expected_count,r.counted_count,r.difference]);
  }else if(kind==='sav_monthly'){
    // Explicit numerator/denominator: returns opened in period / completed sales
    // recorded in the SAME period, grouped by product and seller.
    // This is a period ratio, not a guaranteed same-customer cohort rate.
    const extra=agentFilter?'AND s.agent_user_id=? ':'';
    const [salesRows]=await pool.query(
      'SELECT s.agent_user_id AS agentId,i.product_id AS productId,'+
      'COUNT(*) AS sold FROM sales s JOIN items i ON i.id=s.item_id '+
      "WHERE s.status='COMPLETED' AND DATE(s.created_at) BETWEEN ? AND ? "+
      extra+'GROUP BY s.agent_user_id,i.product_id',
      agentFilter?[...params,agentFilter]:params
    );
    const extraSav=agentFilter?'AND sc.agent_user_id=? ':'';
    const [savRows]=await pool.query(
      'SELECT sc.agent_user_id AS agentId,i.product_id AS productId,'+
      "COUNT(*) AS returned,SUM(CASE WHEN sc.status IN ('OPEN','IN_PROGRESS') THEN 1 ELSE 0 END) AS active "+
      'FROM sav_cases sc JOIN items i ON i.id=sc.item_id '+
      'WHERE DATE(sc.created_at) BETWEEN ? AND ? '+extraSav+
      'GROUP BY sc.agent_user_id,i.product_id',
      agentFilter?[...params,agentFilter]:params
    );
    const [products]=await pool.query('SELECT id,name FROM products');
    const [agents]=await pool.query('SELECT id,name FROM users');
    const productNames=new Map(products.map(x=>[String(x.id),x.name]));
    const agentNames=new Map(agents.map(x=>[String(x.id),x.name]));
    const summary=new Map();
    for(const sale of salesRows){
      const key=String(sale.agentId)+'/'+String(sale.productId);
      summary.set(key,{agentId:String(sale.agentId),productId:String(sale.productId),
        sold:Number(sale.sold),returned:0,active:0});
    }
    for(const record of savRows){
      const key=String(record.agentId)+'/'+String(record.productId);
      if(!summary.has(key))summary.set(key,{
        agentId:String(record.agentId),productId:String(record.productId),
        sold:0,returned:0,active:0,
      });
      const item=summary.get(key);
      item.returned=Number(record.returned);
      item.active=Number(record.active);
    }
    rows=[...summary.values()].sort((a,b)=>b.returned-a.returned).slice(0,5000)
      .map(row=>[
        productNames.get(row.productId)||'Produit archivé',
        agentNames.get(row.agentId)||'Agent archivé',
        row.sold,row.returned,
        row.sold?Math.round(row.returned/row.sold*1000)/10+'%':'N/A',
        row.active,
      ]);
  }else {
    const [data]=await pool.query(
      'SELECT d.id,c.name AS customer,u.name AS agent,d.original_amount_f,'+
      'd.remaining_amount_f,d.due_date,d.status FROM debts d '+
      'JOIN customers c ON c.id=d.customer_id JOIN users u ON u.id=d.agent_user_id '+
      'WHERE DATE(d.created_at) BETWEEN ? AND ? '+(agentFilter?'AND d.agent_user_id=? ':'')+
      'ORDER BY d.due_date,d.id LIMIT 5000',agentFilter?[...params,agentFilter]:params
    );
    rows=data.map(r=>[r.id,r.customer,r.agent,r.original_amount_f,r.remaining_amount_f,
      shortDate(r.due_date),r.status]);
  }
  return {rows,from,to,columns:columns[kind]};
}

function pdfBuffer(title,headers,rows,range){
  return new Promise((resolve,reject)=>{
    const pdf=new PDFDocument({size:'A4',margin:38,bufferPages:true,compress:true});
    const chunks=[];
    pdf.on('data',x=>chunks.push(x));pdf.on('end',()=>resolve(Buffer.concat(chunks)));pdf.on('error',reject);
    pdf.rect(0,0,595,14).fill(BLUE);
    // The same SMTR mark used in the existing web manifest/icon.svg.
    pdf.save();
    pdf.translate(38,34).scale(0.45);
    pdf.roundedRect(0,0,96,96,24).fill(BRAND);
    pdf.path('M22 63V33h13l13 18 13-18h13v30H60V50L48 67 36 50v13Z').fill('#ffffff');
    pdf.circle(72,24,8).fill('#22c99a');
    pdf.restore();
    pdf.fillColor(BRAND).font('Helvetica-Bold').fontSize(17).text('SMTR · SINOCET',88,41);
    pdf.fontSize(12).text(title,38,71);
    pdf.font('Helvetica').fillColor('#667388').fontSize(9).text('Période : '+range+' · Généré le '+shortDate(new Date()),38,94);
    pdf.moveTo(38,118).lineTo(557,118).strokeColor('#d3dbea').stroke();
    let y=132;
    const widths=headers.map(()=>Math.floor(518/headers.length));
    function header(){
      pdf.rect(38,y,519,24).fill('#e8edf8');
      let x=42;
      headers.forEach((h,i)=>{pdf.font('Helvetica-Bold').fillColor('#273756').fontSize(6.7).text(h,x,y+7,{width:widths[i]-4,height:18,ellipsis:true});x+=widths[i];});
      y+=28;
    }
    header();
    for(const record of rows){
      if(y>742){pdf.addPage();y=48;header();}
      const height=32;
      let x=42;
      record.forEach((v,i)=>{
        const text=typeof v==='number'?localeNumber(v):String(v??'—');
        pdf.font('Helvetica').fontSize(7).fillColor('#2a354a')
          .text(text,x,y+6,{width:widths[i]-4,height:height-8,ellipsis:true});
        x+=widths[i];
      });
      pdf.moveTo(38,y+height).lineTo(557,y+height).strokeColor('#e8edf3').stroke();
      y+=height;
    }
    if(!rows.length)pdf.font('Helvetica').fontSize(11).fillColor('#76859a').text('Aucune donnée pour cette période.',38,y+18);
    const totalPages=pdf.bufferedPageRange().count;
    for(let i=0;i<totalPages;i++){
      pdf.switchToPage(i);
      pdf.fontSize(8).fillColor('#8390a4').text('Groupe Sinocet Electronics · Page '+(i+1)+' / '+totalPages,
        38,805,{width:519,align:'right'});
    }
    pdf.end();
  });
}

async function excelBuffer(title,headers,rows,range){
  const book=new ExcelJS.Workbook();
  book.creator='Groupe Sinocet Electronics';
  const sheet=book.addWorksheet('SMTR',{views:[{state:'frozen',ySplit:4}]});
  sheet.mergeCells(1,1,1,headers.length);sheet.getCell(1,1).value='SMTR · SINOCET';
  sheet.getCell(1,1).font={name:'Arial',bold:true,color:{argb:'FFFFFFFF'},size:15};
  sheet.getCell(1,1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF111E3C'}};
  sheet.getRow(1).height=31;
  sheet.mergeCells(2,1,2,headers.length);sheet.getCell(2,1).value=title+' · '+range;
  sheet.getCell(2,1).font={bold:true,size:12};
  sheet.getRow(4).values=headers;
  sheet.getRow(4).eachCell(cell=>{
    cell.font={bold:true,color:{argb:'FFFFFFFF'}};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2D5CE3'}};
    cell.alignment={wrapText:true};
  });
  for(const data of rows){
    const row=sheet.addRow(data.map(v=>typeof v==='number'?v:safeCell(v)));
    row.alignment={vertical:'middle',wrapText:true};
  }
  sheet.columns=headers.map((h,i)=>({
    width:Math.max(15,Math.min(38,Math.max(h.length+3,rows.some(r=>String(r[i]??'').length>20)?25:19))),
  }));
  sheet.autoFilter={from:{row:4,column:1},to:{row:Math.max(4,rows.length+4),column:headers.length}};
  return Buffer.from(await book.xlsx.writeBuffer());
}

export function reportRoutes(pool){
  const router=Router();
  router.use(requireRole('manager','director'));
  router.get('/',(_req,res)=>{
    res.json({reports:[
      {id:'stock_variance',name:labels.stock_variance,frequency:'Quotidien',formats:['pdf','xlsx']},
      {id:'sav_monthly',name:labels.sav_monthly,frequency:'Mensuel',formats:['xlsx','pdf']},
      {id:'sales',name:labels.sales,frequency:'À la demande',formats:['xlsx','pdf']},
      {id:'debts',name:labels.debts,frequency:'À la demande',formats:['pdf','xlsx']},
    ]});
  });
  router.get('/:kind',async(req,res,next)=>{
    try{
      const kind=choice(req.params.kind,Object.keys(labels));
      const format=choice(req.query.format||'pdf',['pdf','xlsx']);
      const {rows,from,to,columns:headers}=await getData(pool,kind,req);
      const range=from+' au '+to;
      const file=format==='pdf'
        ?await pdfBuffer(labels[kind],headers,rows,range)
        :await excelBuffer(labels[kind],headers,rows,range);
      const ext=format==='pdf'?'pdf':'xlsx';
      res.set('Content-Type',format==='pdf'?'application/pdf':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition','attachment; filename="smtr-'+kind+'-'+from+'-'+to+'.'+ext+'"');
      res.set('Cache-Control','private, no-store');
      res.send(file);
    }catch(error){next(error);}
  });
  return router;
}

export function receiptRoutes(pool){
  const router=Router();
  router.get('/sales/:id/receipt',async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Vente');
      const [rows]=await pool.query(
        'SELECT s.id,s.agent_user_id,s.created_at,s.status,s.total_amount_f,s.paid_amount_f,s.credit_amount_f,'+
        's.payment_method,p.name AS product,i.imei,u.name AS agent,c.name AS customer '+
        'FROM sales s JOIN items i ON i.id=s.item_id JOIN products p ON p.id=i.product_id '+
        'JOIN users u ON u.id=s.agent_user_id LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=?',[id]
      );
      const sale=rows[0];
      assert(sale&&!(req.auth.role==='agent'&&String(sale.agent_user_id)!==req.auth.id),
        403,'Reçu non autorisé.');
      const data=[
        ['Vente',id],['Date',shortDate(sale.created_at)],['Client',sale.customer||'Client comptant'],
        ['Produit',sale.product],['IMEI',sale.imei],['Montant FCFA',localeNumber(sale.total_amount_f)],
        ['Encaissé FCFA',localeNumber(sale.paid_amount_f)],['Crédit FCFA',localeNumber(sale.credit_amount_f)],
        ['Mode',sale.payment_method],['Statut',sale.status],
      ];
      const file=await pdfBuffer('Reçu de vente', ['Rubrique','Détail'],data,'Vente #'+id);
      res.set('Content-Type','application/pdf');
      res.set('Cache-Control','private, no-store');
      res.set('Content-Disposition','attachment; filename="smtr-recu-vente-'+id+'.pdf"');
      res.send(file);
    }catch(error){next(error);}
  });
  router.get('/payments/:id/receipt',async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Paiement');
      const [rows]=await pool.query(
        'SELECT p.id,p.agent_user_id,p.amount_f,p.method,p.kind,p.created_at,p.reference,'+
        'c.name AS customer,u.name AS agent FROM payments p JOIN users u ON u.id=p.agent_user_id '+
        'LEFT JOIN debts d ON d.id=p.debt_id LEFT JOIN customers c ON c.id=d.customer_id WHERE p.id=?',[id]
      );
      const payment=rows[0];
      assert(payment&&!(req.auth.role==='agent'&&String(payment.agent_user_id)!==req.auth.id),
        403,'Reçu non autorisé.');
      const data=[
        ['Paiement',id],['Date',shortDate(payment.created_at)],['Client',payment.customer||'Client comptant'],
        ['Montant FCFA',localeNumber(payment.amount_f)],['Mode',payment.method],
        ['Opération',payment.kind],['Référence',payment.reference||'—'],
      ];
      const file=await pdfBuffer('Reçu de paiement',['Rubrique','Détail'],data,'Paiement #'+id);
      res.set('Content-Type','application/pdf');
      res.set('Cache-Control','private, no-store');
      res.set('Content-Disposition','attachment; filename="smtr-recu-paiement-'+id+'.pdf"');
      res.send(file);
    }catch(error){next(error);}
  });
  return router;
}
