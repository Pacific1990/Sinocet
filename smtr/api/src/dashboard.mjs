import { Router } from 'express';

export function dashboardRoutes(pool) {
  const router = Router();
  router.get('/summary',async(req,res,next)=>{
    try {
      const agent=req.auth.role==='agent';
      const stockSql=agent
        ? "SELECT COUNT(*) AS total FROM items i JOIN warehouses w ON w.id=i.warehouse_id WHERE w.kind='AGENT' AND w.agent_user_id=? AND i.state='AVAILABLE'"
        : "SELECT COUNT(*) AS total FROM items i JOIN warehouses w ON w.id=i.warehouse_id WHERE w.kind='CENTRAL' AND i.state='AVAILABLE'";
      const transferSql=agent
        ? "SELECT COUNT(*) AS total FROM transfers tr JOIN warehouses w ON w.id=tr.target_warehouse_id WHERE w.agent_user_id=? AND tr.status='IN_TRANSIT'"
        : "SELECT COUNT(*) AS total FROM transfers WHERE status='IN_TRANSIT'";
      const [stock]=await pool.query(stockSql,agent?[req.auth.id]:[]);
      const [transfers]=await pool.query(transferSql,agent?[req.auth.id]:[]);
      const metrics=[
        {id:'stock',label:agent?'MON STOCK ACTIF':'STOCK CENTRAL DISPONIBLE',value:String(stock[0].total)},
        {id:'transfers',label:'TRANSFERTS À RÉCEPTIONNER',value:String(transfers[0].total)},
      ];
      if(!agent) {
        const [review]=await pool.query("SELECT COUNT(*) AS total FROM transfers WHERE status='DISCREPANCY'");
        metrics.push({id:'discrepancies',label:'ÉCARTS À TRAITER',value:String(review[0].total)});
      }
      // No fake sales, margins or cash values before those modules exist.
      res.json({metrics});
    }catch(error){next(error);}
  });
  return router;
}
