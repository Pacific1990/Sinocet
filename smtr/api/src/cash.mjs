import { Router } from 'express';
import { transaction } from './db.mjs';
import { requireRole } from './auth.mjs';
import { assert } from './errors.mjs';
import { amount, audit, businessDay, idOrFail, lockedUser } from './utils.mjs';

const asInt=value=>Number(value||0);
async function cashSummary(conn,agentId,day){
  const [rows]=await conn.query(
    "SELECT method,kind,COALESCE(SUM(amount_f),0) AS amount FROM payments "+
    "WHERE agent_user_id=? AND DATE(created_at)=? GROUP BY method,kind",
    [agentId,day]
  );
  const totals={CASH:0,MOBILE_MONEY:0,TRANSFER:0};
  for(const row of rows){
    totals[row.method]+=asInt(row.amount)*(row.kind==='REFUND'?-1:1);
  }
  return totals;
}
const project=totals=>({
  cashF:totals.CASH,mobileF:totals.MOBILE_MONEY,transferF:totals.TRANSFER,
  totalF:totals.CASH+totals.MOBILE_MONEY+totals.TRANSFER,
});

export function cashRoutes(pool){
  const router=Router();
  router.get('/today',async(req,res,next)=>{
    try{
      const id=req.auth.role==='agent'?req.auth.id:
        (req.query.agentId?idOrFail(req.query.agentId,'Agent'):req.auth.id);
      const date=businessDay();
      const totals=await cashSummary(pool,id,date);
      const [closed]=await pool.query(
        'SELECT * FROM cash_closures WHERE agent_user_id=? AND business_day=?',[id,date]
      );
      const [rows]=await pool.query(
        "SELECT p.id,p.amount_f,p.method,p.kind,p.created_at,p.reference "+
        "FROM payments p WHERE p.agent_user_id=? AND DATE(p.created_at)=? "+
        "ORDER BY p.created_at DESC LIMIT 200",[id,date]
      );
      res.json({
        day:date,agentId:String(id),expected:project(totals),
        closed:closed.length?{
          id:String(closed[0].id),closedAt:closed[0].closed_at,
          declared:project({
            CASH:asInt(closed[0].declared_cash_f),MOBILE_MONEY:asInt(closed[0].declared_mobile_f),
            TRANSFER:asInt(closed[0].declared_transfer_f),
          }),
        }:null,
        transactions:rows.map(p=>({
          id:String(p.id),amountF:asInt(p.amount_f),method:p.method,kind:p.kind,
          createdAt:p.created_at,reference:p.reference,
        })),
      });
    }catch(error){next(error);}
  });

  router.post('/close',requireRole('agent'),async(req,res,next)=>{
    try{
      const cash=amount(req.body?.declaredCashF);
      const mobile=amount(req.body?.declaredMobileF);
      const transferF=amount(req.body?.declaredTransferF);
      const result=await transaction(pool,async conn=>{
        const user=await lockedUser(conn,req);
        const day=businessDay();
        const [already]=await conn.query('SELECT id FROM cash_closures WHERE agent_user_id=? AND business_day=? FOR UPDATE',[user.id,day]);
        assert(!already.length,409,'Caisse déjà clôturée pour cette journée.');
        const summary=await cashSummary(conn,req.auth.id,day);
        assert(Object.values(summary).every(n=>n>=0),409,'Caisse négative : enquête nécessaire avant clôture.');
        const [r]=await conn.query(
          'INSERT INTO cash_closures(agent_user_id,business_day,expected_cash_f,expected_mobile_f,'+
          'expected_transfer_f,declared_cash_f,declared_mobile_f,declared_transfer_f) '+
          'VALUES(?,?,?,?,?,?,?,?)',
          [user.id,day,summary.CASH,summary.MOBILE_MONEY,summary.TRANSFER,cash,mobile,transferF]
        );
        await audit(conn,req,'CASH_CLOSED','cash_closures',r.insertId,{
          day,expected:summary,declared:{cash,mobile,transferF},
          difference:cash+mobile+transferF-(summary.CASH+summary.MOBILE_MONEY+summary.TRANSFER),
        });
        return {id:String(r.insertId),day,expected:project(summary),
          declared:project({CASH:cash,MOBILE_MONEY:mobile,TRANSFER:transferF})};
      });
      res.status(201).json({closure:result});
    }catch(error){next(error);}
  });

  router.get('/history',async(req,res,next)=>{
    try{
      const agent=req.auth.role==='agent';
      const [rows]=await pool.query(
        'SELECT cl.*,u.name AS agentName FROM cash_closures cl JOIN users u ON u.id=cl.agent_user_id '+
        (agent?'WHERE cl.agent_user_id=? ':'')+
        'ORDER BY cl.business_day DESC LIMIT 100',agent?[req.auth.id]:[]
      );
      res.json({closures:rows.map(row=>({
        id:String(row.id),day:row.business_day,agent:row.agentName,closedAt:row.closed_at,
        expectedF:asInt(row.expected_cash_f)+asInt(row.expected_mobile_f)+asInt(row.expected_transfer_f),
        declaredF:asInt(row.declared_cash_f)+asInt(row.declared_mobile_f)+asInt(row.declared_transfer_f),
      }))});
    }catch(error){next(error);}
  });
  return router;
}
