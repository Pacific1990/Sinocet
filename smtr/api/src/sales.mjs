import { Router } from 'express';
import { transaction } from './db.mjs';
import { requireRole } from './auth.mjs';
import { assert, HttpError, maskImei } from './errors.mjs';
import { amount, audit, businessDay, choice, dateValue, hash, idOrFail, lockedUser, uuid } from './utils.mjs';

export function salesRoutes(pool){
  const router=Router();

  router.get('/stock',requireRole('agent'),async(req,res,next)=>{
    try{
      const q=typeof req.query.q==='string'?req.query.q.trim().slice(0,70):'';
      const [items]=await pool.query(
        "SELECT i.id,p.name,p.category,p.sale_price_f AS priceF,i.imei "+
        "FROM items i JOIN products p ON p.id=i.product_id "+
        "JOIN warehouses w ON w.id=i.warehouse_id AND w.kind='AGENT' "+
        "WHERE w.agent_user_id=? AND w.active=1 AND w.frozen=0 AND i.state='AVAILABLE' "+
        "AND p.active=1 AND (i.imei LIKE CONCAT('%',?,'%') OR p.name LIKE CONCAT('%',?,'%')) "+
        'ORDER BY p.name,i.id LIMIT 100',
        [req.auth.id,q,q]
      );
      res.json({items:items.map(row=>({
        id:String(row.id),name:row.name,category:row.category,
        priceF:row.priceF===null?null:Number(row.priceF),imeiMasked:maskImei(row.imei),
      }))});
    }catch(error){next(error);}
  });

  router.get('/',async(req,res,next)=>{
    try{
      const agent=req.auth.role==='agent';
      const [rows]=await pool.query(
        'SELECT s.id,s.status,s.created_at,s.total_amount_f,s.paid_amount_f,s.credit_amount_f,'+
        's.payment_method,i.imei,p.name AS product,u.name AS agent,c.name AS customer '+
        'FROM sales s JOIN items i ON i.id=s.item_id JOIN products p ON p.id=i.product_id '+
        'JOIN users u ON u.id=s.agent_user_id LEFT JOIN customers c ON c.id=s.customer_id '+
        (agent?'WHERE s.agent_user_id=? ':'')+'ORDER BY s.created_at DESC,s.id DESC LIMIT 250',
        agent?[req.auth.id]:[]
      );
      res.json({items:rows.map(row=>({
        id:String(row.id),title:row.product,subtitle:'#'+row.id+' · '+maskImei(row.imei)+' · '+(row.customer||'Client comptant'),
        agent:row.agent,totalAmountF:Number(row.total_amount_f),
        paidAmountF:Number(row.paid_amount_f),creditAmountF:Number(row.credit_amount_f),
        paymentMethod:row.payment_method,status:row.status,createdAt:row.created_at,
      }))});
    }catch(error){next(error);}
  });

  router.post('/',requireRole('agent'),async(req,res,next)=>{
    try{
      const body=req.body||{};
      const itemId=idOrFail(body.itemId,'IMEI');
      const customerId=body.customerId? idOrFail(body.customerId,'Client') : null;
      const approvalId=body.approvalId?idOrFail(body.approvalId,'Validation manager'):null;
      const requestId=uuid(body.requestId);
      const mode=choice(body.paymentMethod,['CASH','MOBILE_MONEY','TRANSFER','CREDIT']);
      const paid=amount(body.paidAmountF);
      const collectedVia=mode==='CREDIT'
        ?(paid?choice(body.collectedVia,['CASH','MOBILE_MONEY','TRANSFER']):null)
        :mode;
      const dueDate=body.dueDate?dateValue(body.dueDate):null;
      const reference=body.paymentReference===undefined||body.paymentReference===null?null:
        String(body.paymentReference).trim().slice(0,120);
      const requestHash=hash({itemId,customerId,approvalId,requestId,mode,paid,collectedVia,dueDate,reference});

      const outcome=await transaction(pool,async conn=>{
        const user=await lockedUser(conn,req); // Mutex for sales/repayments/daily closures.
        const [previous]=await conn.query(
          'SELECT id,request_hash FROM sales WHERE agent_user_id=? AND request_id=? FOR UPDATE',
          [user.id,requestId]
        );
        if(previous.length){
          assert(previous[0].request_hash===requestHash,409,'Cette requête a déjà un autre contenu.');
          return {id:String(previous[0].id),replayed:true};
        }
        const [closed]=await conn.query('SELECT id FROM cash_closures WHERE agent_user_id=? AND business_day=?',[user.id,businessDay()]);
        assert(!closed.length,409,'Caisse du jour déjà clôturée.');
        const [items]=await conn.query(
          'SELECT i.id,i.state,i.warehouse_id,p.sale_price_f,p.purchase_cost_f,'+
          'w.kind,w.agent_user_id,w.frozen,w.active '+
          'FROM items i JOIN products p ON p.id=i.product_id '+
          'JOIN warehouses w ON w.id=i.warehouse_id WHERE i.id=? FOR UPDATE',
          [itemId]
        );
        const item=items[0];
        assert(item&&item.state==='AVAILABLE'&&item.kind==='AGENT'&&
          String(item.agent_user_id)===req.auth.id&&item.active===1&&!item.frozen,
          409,'IMEI indisponible ou stock agent gelé.');
        assert(item.sale_price_f!==null&&Number(item.sale_price_f)>0,
          422,'Prix de vente non configuré par la Direction.');
        const gross=Number(item.sale_price_f);
        assert(Number.isSafeInteger(gross),422,'Prix de vente invalide.');
        let discount=0;
        if(approvalId){
          const [approvals]=await conn.query(
            "SELECT id,status,discount_percent,requested_by_user_id,item_id FROM approvals "+
            "WHERE id=? AND kind='DISCOUNT' FOR UPDATE",[approvalId]
          );
          const approval=approvals[0];
          assert(approval&&approval.status==='APPROVED'&&
            String(approval.requested_by_user_id)===req.auth.id&&String(approval.item_id)===itemId,
            409,'Remise non approuvée ou déjà utilisée.');
          discount=Math.round(gross*Number(approval.discount_percent)/100);
        }
        const total=gross-discount;
        assert(paid<=total,422,'Paiement supérieur au total de la vente.');
        const credit=total-paid;
        assert((mode==='CREDIT')===(credit>0),422,
          'Choisissez Crédit seulement pour une vente non entièrement encaissée.');
        assert(credit===0||customerId&&dueDate,422,'Client et échéance obligatoires pour crédit.');
        if(credit>0){
          const due=new Date(dueDate+'T00:00:00Z').getTime();
          assert(due>=Date.now()-86400000&&due<Date.now()+366*86400000,
            422,'Échéance de crédit hors délai autorisé.');
          const [customers]=await conn.query('SELECT * FROM customers WHERE id=? FOR UPDATE',[customerId]);
          const c=customers[0];
          assert(c&&c.active===1&&String(c.agent_user_id)===req.auth.id,
            403,'Client non attribué à cet agent.');
          const [owedCustomer]=await conn.query(
            "SELECT COALESCE(SUM(remaining_amount_f),0) AS total FROM debts WHERE customer_id=? AND status='OPEN'",
            [customerId]
          );
          const [owedAgent]=await conn.query(
            "SELECT COALESCE(SUM(remaining_amount_f),0) AS total FROM debts WHERE agent_user_id=? AND status='OPEN'",
            [req.auth.id]
          );
          assert(Number(c.credit_limit_f)>0&&Number(owedCustomer[0].total)+credit<=Number(c.credit_limit_f),
            409,'Plafond de crédit du client dépassé.');
          assert(Number(user.credit_limit_f)>0&&Number(owedAgent[0].total)+credit<=Number(user.credit_limit_f),
            409,"Plafond de crédit de l'agent dépassé.");
        }
        const [insert]=await conn.query(
          "INSERT INTO sales(agent_user_id,customer_id,item_id,request_id,request_hash,"+
          "gross_amount_f,discount_amount_f,total_amount_f,paid_amount_f,credit_amount_f,"+
          "cost_amount_f,payment_method,payment_reference,approval_id,status) "+
          "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'COMPLETED')",
          [req.auth.id,customerId,itemId,requestId,requestHash,gross,discount,total,paid,
            credit,item.purchase_cost_f,mode,reference,approvalId]
        );
        const saleId=String(insert.insertId);
        const [sold]=await conn.query(
          "UPDATE items SET state='SOLD',sold_at=UTC_TIMESTAMP(),current_sale_id=? WHERE id=? AND state='AVAILABLE'",[saleId,itemId]
        );
        assert(sold.affectedRows===1,409,'IMEI déjà réservé ou vendu.');
        if(credit>0){
          await conn.query(
            "INSERT INTO debts(sale_id,customer_id,agent_user_id,original_amount_f,remaining_amount_f,due_date) VALUES(?,?,?,?,?,?)",
            [saleId,customerId,req.auth.id,credit,credit,dueDate]
          );
        }
        if(paid>0){
          await conn.query(
            "INSERT INTO payments(sale_id,agent_user_id,amount_f,method,kind,reference,request_id) "+
            "VALUES(?,?,?,?,'SALE',?,?)",
            [saleId,req.auth.id,paid,collectedVia,reference,requestId]
          );
        }
        if(approvalId)await conn.query(
          "UPDATE approvals SET status='APPLIED',applied_at=UTC_TIMESTAMP() WHERE id=?",[approvalId]
        );
        await conn.query(
          'INSERT INTO movements(item_id,actor_user_id,kind,origin_warehouse_id,reference_type,reference_id) VALUES(?,?,?,?,?,?)',
          [itemId,req.auth.id,'SOLD',item.warehouse_id,'SALE',saleId]
        );
        await audit(conn,req,'SALE_COMPLETED','sales',saleId,{
          itemId,total,credit,paid,discount,customerId,before:'AVAILABLE',after:'SOLD',
        });
        return {id:saleId,totalAmountF:total,creditAmountF:credit,replayed:false};
      });
      res.status(outcome.replayed?200:201).json({sale:outcome});
    }catch(error){next(error);}
  });
  return router;
}
