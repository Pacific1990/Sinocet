import { Router } from 'express';
import { transaction } from './db.mjs';
import { requireRole } from './auth.mjs';
import { assert } from './errors.mjs';
import { amount, audit, businessDay, choice, idOrFail, lockedUser, textValue, uuid } from './utils.mjs';

export function creditsRoutes(pool) {
  const router=Router();

  router.get('/customers',async(req,res,next)=>{
    try{
      const agent=req.auth.role==='agent';
      const [rows]=await pool.query(
        'SELECT c.id,c.name,c.phone,c.agent_user_id,c.credit_limit_f,u.name AS agentName,'+
        'COALESCE(SUM(CASE WHEN d.status=\'OPEN\' THEN d.remaining_amount_f ELSE 0 END),0) AS balance '+
        'FROM customers c JOIN users u ON u.id=c.agent_user_id LEFT JOIN debts d ON d.customer_id=c.id '+
        (agent?'WHERE c.agent_user_id=? ':'')+
        'GROUP BY c.id,c.name,c.phone,c.agent_user_id,c.credit_limit_f,u.name ORDER BY c.name LIMIT 500',
        agent?[req.auth.id]:[]
      );
      res.json({customers:rows.map(c=>({
        id:String(c.id),name:c.name,phone:c.phone,agentId:String(c.agent_user_id),
        agentName:c.agentName,creditLimitF:Number(c.credit_limit_f),balanceF:Number(c.balance),
      }))});
    }catch(error){next(error);}
  });

  router.post('/customers',async(req,res,next)=>{
    try{
      const name=textValue(req.body?.name,2,160);
      const phone=req.body?.phone==null?null:textValue(req.body.phone,5,35);
      const agentId=req.auth.role==='agent'?req.auth.id:idOrFail(req.body?.agentId,'Agent');
      const outcome=await transaction(pool,async conn=>{
        const [u]=await conn.query(
          "SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.active=1 AND r.code='agent'",
          [agentId]
        );
        assert(u.length,422,'Agent destinataire non valide.');
        const [r]=await conn.query(
          'INSERT INTO customers(name,phone,agent_user_id) VALUES(?,?,?)',[name,phone,agentId]
        );
        await audit(conn,req,'CUSTOMER_CREATED','customers',r.insertId,{agentId,name});
        return String(r.insertId);
      });
      res.status(201).json({customer:{id:outcome}});
    }catch(error){next(error);}
  });

  router.patch('/customers/:id/limit',requireRole('director','manager'),async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Client');
      const limit=amount(req.body?.creditLimitF);
      const outcome=await transaction(pool,async conn=>{
        const [rows]=await conn.query(
          'SELECT credit_limit_f FROM customers WHERE id=? FOR UPDATE',[id]
        );
        assert(rows.length,404,'Client introuvable.');
        const [owed]=await conn.query(
          "SELECT COALESCE(SUM(remaining_amount_f),0) AS amount FROM debts WHERE customer_id=? AND status='OPEN'",[id]
        );
        assert(limit>=Number(owed[0].amount),409,'Nouveau plafond inférieur à la dette existante.');
        await conn.query('UPDATE customers SET credit_limit_f=? WHERE id=?',[limit,id]);
        await audit(conn,req,'CUSTOMER_CREDIT_LIMIT','customers',id,{
          before:Number(rows[0].credit_limit_f),after:limit,
        });
        return {id,creditLimitF:limit};
      });
      res.json({customer:outcome});
    }catch(error){next(error);}
  });

  router.get('/debts',async(req,res,next)=>{
    try{
      const agent=req.auth.role==='agent';
      const [rows]=await pool.query(
        "SELECT d.id,d.sale_id,d.customer_id,c.name AS customer,c.phone,c.credit_limit_f,"+
        "u.name AS agent,d.original_amount_f,d.remaining_amount_f,d.due_date,d.status "+
        "FROM debts d JOIN customers c ON c.id=d.customer_id JOIN users u ON u.id=d.agent_user_id "+
        (agent?"WHERE d.agent_user_id=? ":"")+
        "ORDER BY CASE WHEN d.status='OPEN' THEN 0 ELSE 1 END,d.due_date,d.id LIMIT 500",
        agent?[req.auth.id]:[]
      );
      const items=rows.map(d=>{
        const overdue=d.status==='OPEN'&&new Date(d.due_date)<new Date(businessDay()+'T00:00:00Z');
        return {
          id:String(d.id),saleId:String(d.sale_id),customerId:String(d.customer_id),
          customer:d.customer,agent:d.agent,amountF:Number(d.remaining_amount_f),
          initialAmountF:Number(d.original_amount_f),creditLimitF:Number(d.credit_limit_f),
          dueDate:d.due_date,status:d.status==='PAID'?'Payé':d.status==='CANCELLED'?'Annulé':
            overdue?'Dépassée':'À venir',
        };
      });
      const open=items.filter(d=>d.status!=='Payé'&&d.status!=='Annulé');
      const [recovered]=await pool.query(
        "SELECT COALESCE(SUM(p.amount_f),0) AS recoveredF FROM payments p "+
        "WHERE p.kind='REPAYMENT' AND DATE(p.created_at)>=DATE_FORMAT(UTC_DATE(),'%Y-%m-01') "+
        (agent?"AND p.agent_user_id=?":""),
        agent?[req.auth.id]:[]
      );
      res.json({debts:items,summary:{
        recoveredThisMonthF:Number(recovered[0].recoveredF),
        overdueCustomersCount:new Set(open.filter(d=>d.status==='Dépassée').map(d=>d.customerId)).size,
        outstandingF:open.reduce((n,d)=>n+d.amountF,0),
        overdueCount:open.filter(d=>d.status==='Dépassée').length,
        customerCount:new Set(open.map(d=>d.customerId)).size,
      }});
    }catch(error){next(error);}
  });

  router.get('/debts/:id/reminder',async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Dette');
      const [rows]=await pool.query(
        'SELECT d.remaining_amount_f,d.due_date,d.status,c.name,c.phone,d.agent_user_id '+
        'FROM debts d JOIN customers c ON c.id=d.customer_id WHERE d.id=?',[id]
      );
      const debt=rows[0];
      assert(debt,404,'Dette introuvable.');
      assert(req.auth.role!=='agent'||String(debt.agent_user_id)===req.auth.id,403,
        'Client hors portefeuille.');
      const date=new Date(debt.due_date).toLocaleDateString('fr-FR',{timeZone:'UTC'});
      const message='Bonjour '+debt.name+', nous vous rappelons votre échéance du '+date+
        ' concernant un solde de '+Number(debt.remaining_amount_f).toLocaleString('fr-FR')+
        ' FCFA auprès de Groupe Sinocet Electronics. Merci de nous contacter pour régulariser.';
      const phone=String(debt.phone||'').replace(/[^\d]/g,'');
      res.json({message,phone,whatsappUrl:phone?'https://wa.me/'+phone+'?text='+encodeURIComponent(message):null});
    }catch(error){next(error);}
  });

  router.post('/debts/:id/payments',requireRole('agent'),async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Dette');
      const pay=amount(req.body?.amountF,{min:1});
      const method=choice(req.body?.method,['CASH','MOBILE_MONEY','TRANSFER']);
      const requestId=uuid(req.body?.requestId);
      const reference=req.body?.reference?textValue(req.body.reference,1,120):null;
      const outcome=await transaction(pool,async conn=>{
        const user=await lockedUser(conn,req);
        const [prior]=await conn.query(
          'SELECT id,debt_id,amount_f,method FROM payments WHERE agent_user_id=? AND request_id=? FOR UPDATE',
          [req.auth.id,requestId]
        );
        if(prior.length){
          assert(String(prior[0].debt_id)===id&&Number(prior[0].amount_f)===pay&&prior[0].method===method,
            409,'Clé de paiement déjà utilisée.');
          return {id:String(prior[0].id),replayed:true};
        }
        const [closed]=await conn.query('SELECT id FROM cash_closures WHERE agent_user_id=? AND business_day=?',[user.id,businessDay()]);
        assert(!closed.length,409,'Caisse déjà clôturée : reportez le paiement au jour suivant.');
        const [rows]=await conn.query('SELECT id,remaining_amount_f,agent_user_id,status FROM debts WHERE id=? FOR UPDATE',[id]);
        const debt=rows[0];
        assert(debt&&String(debt.agent_user_id)===req.auth.id,403,'Dette hors portefeuille.');
        assert(debt.status==='OPEN'&&Number(debt.remaining_amount_f)>=pay,409,'Dette réglée ou montant trop élevé.');
        const remaining=Number(debt.remaining_amount_f)-pay;
        await conn.query(
          'UPDATE debts SET remaining_amount_f=?,status=? WHERE id=?',
          [remaining,remaining===0?'PAID':'OPEN',id]
        );
        const [payment]=await conn.query(
          "INSERT INTO payments(debt_id,agent_user_id,amount_f,method,kind,reference,request_id) "+
          "VALUES(?,?,?,?,'REPAYMENT',?,?)",
          [id,req.auth.id,pay,method,reference,requestId]
        );
        await audit(conn,req,'DEBT_REPAID','debts',id,{before:Number(debt.remaining_amount_f),after:remaining,paymentId:String(payment.insertId)});
        return {id:String(payment.insertId),remainingF:remaining,replayed:false};
      });
      res.status(outcome.replayed?200:201).json({payment:outcome});
    }catch(error){next(error);}
  });

  return router;
}
