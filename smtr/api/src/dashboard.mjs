import { applicationSettings } from './configuration.mjs';
import { Router } from 'express';
import { businessDay } from './utils.mjs';

const f=n=>Number(n||0).toLocaleString('fr-FR')+' F';
const metric=(id,label,value,hint)=>({id,label,value:String(value),...(hint?{hint}:{})});
export function dashboardRoutes(pool){
  const router=Router();
  router.get('/summary',async(req,res,next)=>{
    try {
      const role=req.auth.role,agent=role==='agent';
      const day=businessDay();
      const [sales]=await pool.query(
        "SELECT COUNT(*) AS quantity,COALESCE(SUM(total_amount_f),0) AS total,"+
        "COALESCE(SUM(CASE WHEN cost_amount_f IS NULL THEN 1 ELSE 0 END),0) AS missingCost,"+
        "COALESCE(SUM(cost_amount_f),0) AS cost "+
        "FROM sales WHERE status='COMPLETED' AND DATE(created_at)=? "+
        (agent?"AND agent_user_id=?":""),
        agent?[day,req.auth.id]:[day]
      );
      const sale=sales[0];
      const metrics=[];
      if(agent){
        const [cash]=await pool.query(
          "SELECT COALESCE(SUM(CASE WHEN kind='REFUND' THEN -amount_f ELSE amount_f END),0) AS amount "+
          "FROM payments WHERE method='CASH' AND agent_user_id=? AND DATE(created_at)=?",
          [req.auth.id,day]
        );
        const [clients]=await pool.query(
          "SELECT COUNT(DISTINCT customer_id) AS total FROM debts WHERE status='OPEN' AND agent_user_id=?",
          [req.auth.id]
        );
        metrics.push(metric('sales','VENTES DU JOUR',sale.quantity));
        metrics.push(metric('revenue','CA DU JOUR',f(sale.total)));
        metrics.push(metric('cash','CASH EN MAIN',f(cash[0].amount)));
        metrics.push(metric('credits','CLIENTS EN CRÉDIT',clients[0].total));
      }else{
        const [sav]=await pool.query("SELECT COUNT(*) AS total FROM sav_cases WHERE status IN ('OPEN','IN_PROGRESS')");
        const [variance]=await pool.query(
          "SELECT COUNT(*) AS total FROM transfers WHERE status='DISCREPANCY'"
        );
        const [pending]=await pool.query(
          "SELECT COUNT(*) AS total FROM transfers WHERE status='IN_TRANSIT'"
        );
        const [idle]=await pool.query(
          "SELECT COUNT(DISTINCT p.id) AS total FROM items i "+
          "JOIN products p ON p.id=i.product_id JOIN warehouses w ON w.id=i.warehouse_id "+
          "WHERE i.state='AVAILABLE' AND w.kind='CENTRAL' AND i.received_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 10 DAY)"
        );
        if(role==='director'){
          metrics.push(metric('revenue','CA DU JOUR',f(sale.total)));
          const missing=Number(sale.missingCost)>0||Number(sale.quantity)===0;
          const margin=missing?'Non renseignée':Math.round(
            (Number(sale.total)-Number(sale.cost))/Number(sale.total)*1000
          )/10+'%';
          metrics.push(metric('margin','MARGE RÉELLE CONSOLIDÉE',margin,
            missing?'Prix d’achat manquant ou aucune vente':'Sur les ventes du jour'));
          metrics.push(metric('variance','ÉCARTS DE STOCK DÉTECTÉS',variance[0].total));
          metrics.push(metric('sav','DOSSIERS SAV OUVERTS',sav[0].total));
        }else{
          metrics.push(metric('pending','TRANSFERTS EN ATTENTE',pending[0].total));
          metrics.push(metric('idle','STOCK IMMOBILE > 10 J',idle[0].total));
          metrics.push(metric('revenue','VENTES DU JOUR (ÉQUIPE)',f(sale.total)));
          metrics.push(metric('sav','DOSSIERS SAV OUVERTS',sav[0].total));
        }
      }
      res.json({metrics});
    }catch(error){next(error);}
  });

  router.get('/overview',async(req,res,next)=>{
    try {
      const settings=await applicationSettings(pool);
      const agent=req.auth.role==='agent';
      const [ranking]=await pool.query(
        "SELECT u.id,u.name AS agent,COUNT(s.id) AS salesCount,"+
        "COALESCE(SUM(s.total_amount_f),0) AS turnover,"+
        "(SELECT COUNT(*) FROM items i JOIN warehouses w ON w.id=i.warehouse_id "+
        "WHERE w.agent_user_id=u.id AND i.state='AVAILABLE') AS activeStock "+
        "FROM users u JOIN roles r ON r.id=u.role_id AND r.code='agent' "+
        "LEFT JOIN sales s ON s.agent_user_id=u.id AND s.status='COMPLETED' AND DATE(s.created_at)=UTC_DATE() "+
        "WHERE u.active=1 "+(agent?"AND u.id=? ":"")+
        "GROUP BY u.id,u.name ORDER BY turnover DESC LIMIT 50",
        agent?[req.auth.id]:[]
      );
      let alerts=[];
      if(agent){
        const [overdue]=await pool.query(
          "SELECT COUNT(*) AS count FROM debts WHERE agent_user_id=? AND status='OPEN' AND due_date<UTC_DATE()",
          [req.auth.id]
        );
        const [waiting]=await pool.query(
          "SELECT COUNT(*) AS count FROM transfers tr JOIN warehouses w ON w.id=tr.target_warehouse_id "+
          "WHERE w.agent_user_id=? AND tr.status='IN_TRANSIT'",[req.auth.id]
        );
        if(Number(overdue[0].count))alerts.push({
          id:'overdue',kind:'danger',message:overdue[0].count+' échéance(s) de crédit dépassée(s)',module:'debts',
        });
        if(Number(waiting[0].count))alerts.push({
          id:'waiting',kind:'warning',message:waiting[0].count+' transfert(s) en attente de validation',module:'transfers',
        });
      }else{
        const [anomalies]=await pool.query("SELECT COUNT(*) AS count FROM transfers WHERE status='DISCREPANCY'");
        const [late]=await pool.query(
          "SELECT COUNT(*) AS count FROM transfers WHERE status='IN_TRANSIT' AND sent_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? DAY)",[settings.transitDays]
        );
        const [idle]=await pool.query(
          "SELECT COUNT(DISTINCT p.id) AS count FROM items i JOIN products p ON p.id=i.product_id "+
          "WHERE i.state='AVAILABLE' AND i.received_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 10 DAY)"
        );
        const [sav]=await pool.query(
          "SELECT COUNT(*) AS count FROM sav_cases WHERE status IN ('OPEN','IN_PROGRESS') "+
          "AND created_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? DAY)",[settings.savDays]
        );
        const values=[
          ['variance',Number(anomalies[0].count),'Écart(s) de stock signalé(s)','danger','inventory'],
          ['late',Number(late[0].count),'Transfert(s) en attente depuis plus de '+settings.transitDays+' jours','warning','transfers'],
          ['idle',Number(idle[0].count),'Référence(s) en stock immobile > 10 jours','warning','stocks'],
          ['sav',Number(sav[0].count),'Dossier(s) SAV ouverts depuis > '+settings.savDays+' jours','danger','cases'],
        ];
        alerts=values.filter(x=>x[1]).map(([id,n,label,kind,module])=>({id,kind,message:n+' '+label,module}));
      }
      res.json({
        ranking:ranking.map(row=>({
          id:String(row.id),name:row.agent,salesCount:Number(row.salesCount),
          turnoverF:Number(row.turnover),activeStock:Number(row.activeStock),
        })),
        alerts,
      });
    }catch(error){next(error);}
  });
  return router;
}
