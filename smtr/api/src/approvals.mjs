import { Router } from 'express';
import argon2 from 'argon2';
import { rateLimit } from 'express-rate-limit';
import { transaction } from './db.mjs';
import { requireRole } from './auth.mjs';
import { assert } from './errors.mjs';
import { audit, choice, idOrFail, textValue, uuid, businessDay } from './utils.mjs';

export function approvalsRoutes(pool){
  const router=Router();

  router.get('/',requireRole('manager','director'),async(req,res,next)=>{
    try {
      const [rows]=await pool.query(
        'SELECT a.id,a.kind,a.status,a.sale_id,a.item_id,a.sav_case_id,a.discount_percent,'+
        'a.resolution,a.reason,a.created_at AS createdAt,u.name AS requestedBy,'+
        'v.name AS reviewedBy FROM approvals a JOIN users u ON u.id=a.requested_by_user_id '+
        'LEFT JOIN users v ON v.id=a.reviewed_by_user_id '+
        'ORDER BY CASE WHEN a.status=\'PENDING\' THEN 0 ELSE 1 END,a.created_at DESC LIMIT 250'
      );
      res.json({approvals:rows.map(a=>({
        id:String(a.id),kind:a.kind,status:a.status,reason:a.reason,
        saleId:a.sale_id?String(a.sale_id):null,itemId:a.item_id?String(a.item_id):null,
        caseId:a.sav_case_id?String(a.sav_case_id):null,
        discountPercent:a.discount_percent===null?null:Number(a.discount_percent),
        resolution:a.resolution,createdAt:a.createdAt,requestedBy:a.requestedBy,reviewedBy:a.reviewedBy,
      }))});
    }catch(error){next(error);}
  });

  router.get('/mine',requireRole('agent'),async(req,res,next)=>{
    try{
      const [rows]=await pool.query(
        "SELECT a.id,a.kind,a.status,a.sale_id,a.item_id,a.sav_case_id,a.discount_percent,"+
        "a.resolution,a.reason,a.created_at AS createdAt,v.name AS reviewedBy "+
        "FROM approvals a LEFT JOIN users v ON v.id=a.reviewed_by_user_id "+
        "WHERE a.requested_by_user_id=? ORDER BY a.created_at DESC LIMIT 100",
        [req.auth.id]
      );
      res.json({approvals:rows.map(a=>({
        id:String(a.id),kind:a.kind,status:a.status,reason:a.reason,
        saleId:a.sale_id?String(a.sale_id):null,
        itemId:a.item_id?String(a.item_id):null,
        caseId:a.sav_case_id?String(a.sav_case_id):null,
        discountPercent:a.discount_percent===null?null:Number(a.discount_percent),
        resolution:a.resolution,createdAt:a.createdAt,
        requestedBy:req.auth.name,reviewedBy:a.reviewedBy||null,
      }))});
    }catch(error){next(error);}
  });

  router.post('/',requireRole('agent'),async(req,res,next)=>{
    try{
      const kind=choice(req.body?.kind,['DISCOUNT','CANCEL_SALE','SAV_RESOLUTION']);
      const reason=textValue(req.body?.reason,8,500);
      const itemId=kind==='DISCOUNT'?idOrFail(req.body?.itemId,'IMEI'):null;
      const saleId=kind==='CANCEL_SALE'?idOrFail(req.body?.saleId,'Vente'):null;
      const caseId=kind==='SAV_RESOLUTION'?idOrFail(req.body?.caseId,'SAV'):null;
      const percent=kind==='DISCOUNT'?Number(req.body?.discountPercent):null;
      const resolution=kind==='SAV_RESOLUTION'?choice(req.body?.resolution,['REPAIR','EXCHANGE','REFUND']):null;
      if(kind==='DISCOUNT')assert(Number.isInteger(percent)&&percent>=1&&percent<=100,
        422,'Remise invalide.');
      const id=await transaction(pool,async conn=>{
        if(itemId){
          const [items]=await conn.query(
            "SELECT i.id FROM items i JOIN warehouses w ON w.id=i.warehouse_id "+
            "WHERE i.id=? AND i.state='AVAILABLE' AND w.kind='AGENT' AND w.agent_user_id=?",
            [itemId,req.auth.id]);
          assert(items.length,403,"Cet IMEI n'appartient pas à votre stock vendable.");
        }
        if(saleId){
          const [sales]=await conn.query("SELECT id FROM sales WHERE id=? AND agent_user_id=? AND status='COMPLETED'",
            [saleId,req.auth.id]);
          assert(sales.length,403,'Vente non attribuée à cet agent.');
        }
        if(caseId){
          const [cases]=await conn.query(
            "SELECT id FROM sav_cases WHERE id=? AND agent_user_id=? AND status IN ('OPEN','IN_PROGRESS')",
            [caseId,req.auth.id]);
          assert(cases.length,403,'Dossier SAV non attribué à cet agent.');
        }
        const [duplicate]=await conn.query(
          "SELECT id FROM approvals WHERE kind=? AND requested_by_user_id=? "+
          "AND ((? IS NOT NULL AND item_id=?) OR (? IS NOT NULL AND sale_id=?) OR "+
          "(? IS NOT NULL AND sav_case_id=?)) AND status IN ('PENDING','APPROVED') LIMIT 1",
          [kind,req.auth.id,itemId,itemId,saleId,saleId,caseId,caseId]
        );
        assert(!duplicate.length,409,'Une validation est déjà en attente.');
        const [ins]=await conn.query(
          "INSERT INTO approvals(requested_by_user_id,kind,sale_id,item_id,sav_case_id,"+
          "discount_percent,resolution,reason) VALUES(?,?,?,?,?,?,?,?)",
          [req.auth.id,kind,saleId,itemId,caseId,percent,resolution,reason]
        );
        await audit(conn,req,'APPROVAL_REQUESTED','approvals',ins.insertId,{kind,reason});
        return String(ins.insertId);
      });
      res.status(201).json({approval:{id,status:'PENDING'}});
    }catch(error){next(error);}
  });

  router.post('/:id/decision',requireRole('manager','director'),rateLimit({
    windowMs:15*60*1000,limit:12,standardHeaders:'draft-7',legacyHeaders:false,
    message:{message:'Trop de tentatives de validation.'},
  }),async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Validation');
      const decision=choice(req.body?.decision,['APPROVED','REJECTED']);
      const code=String(req.body?.approvalCode||'');
      assert(/^\d{6}$/.test(code),422,'Code de validation Manager à six chiffres requis.');
      const outcome=await transaction(pool,async conn=>{
        const [actors]=await conn.query(
          'SELECT approval_pin_hash,active FROM users WHERE id=? FOR UPDATE',[req.auth.id]
        );
        assert(actors.length&&actors[0].active===1,401,'Compte inactif.');
        assert(actors[0].approval_pin_hash,403,'Code Manager non configuré par le responsable.');
        const valid=await argon2.verify(actors[0].approval_pin_hash,code);
        if(!valid)return {denied:true};
        const [rows]=await conn.query("SELECT id,status,kind FROM approvals WHERE id=? FOR UPDATE",[id]);
        const row=rows[0];
        assert(row,404,'Validation introuvable.');
        assert(row.status==='PENDING',409,'Décision déjà prise sur cette demande.');
        await conn.query(
          'UPDATE approvals SET status=?,reviewed_by_user_id=?,reviewed_at=UTC_TIMESTAMP() WHERE id=?',
          [decision,req.auth.id,id]
        );
        await audit(conn,req,'APPROVAL_DECIDED','approvals',id,{kind:row.kind,decision});
        return {id,status:decision};
      });
      assert(!outcome.denied,403,'Code de validation incorrect.');
      res.json({approval:outcome});
    }catch(error){next(error);}
  });

  router.post('/sales/:id/cancel',requireRole('manager','director'),async(req,res,next)=>{
    try{
      const saleId=idOrFail(req.params.id,'Vente');
      const approvalId=idOrFail(req.body?.approvalId,'Validation');
      const returnedImei=textValue(req.body?.returnedImei,15,16);
      assert(/^\d{15,16}$/.test(returnedImei),422,'IMEI de retour invalide.');
      const refundMethod=choice(req.body?.refundMethod,['CASH','MOBILE_MONEY','TRANSFER']);
      const requestId=uuid(req.body?.requestId);
      const outcome=await transaction(pool,async conn=>{
        const [approved]=await conn.query(
          "SELECT id,sale_id,status FROM approvals WHERE id=? AND kind='CANCEL_SALE' FOR UPDATE",
          [approvalId]
        );
        assert(approved[0]&&String(approved[0].sale_id)===saleId&&approved[0].status==='APPROVED',
          409,'Annulation non approuvée ou déjà utilisée.');
        const [sales]=await conn.query(
          'SELECT s.*,i.id AS item_id,i.imei,i.state,i.warehouse_id,w.kind,w.frozen FROM sales s '+
          'JOIN items i ON i.current_sale_id=s.id JOIN warehouses w ON w.id=i.warehouse_id '+
          'WHERE s.id=? FOR UPDATE',[saleId]
        );
        const sale=sales[0];
        assert(sale&&sale.status==='COMPLETED'&&sale.imei===returnedImei&&
          sale.state==='SOLD'&&sale.kind==='AGENT'&&!sale.frozen,409,
          'Retour physique non vérifié, appareil en SAV ou vente déjà annulée.');
        // Lock the original agent user so daily cash closure cannot race a refund.
        const [agents]=await conn.query('SELECT id FROM users WHERE id=? FOR UPDATE',[sale.agent_user_id]);
        assert(agents.length,409,'Agent introuvable.');
        const [closed]=await conn.query('SELECT id FROM cash_closures WHERE agent_user_id=? AND business_day=?',
          [sale.agent_user_id,businessDay()]);
        assert(!closed.length,409,'Caisse déjà clôturée : remboursement différé.');
        const [refunds]=await conn.query(
          "SELECT id FROM payments WHERE agent_user_id=? AND request_id=?",[sale.agent_user_id,requestId]
        );
        assert(!refunds.length,409,'Référence déjà utilisée.');
        const [paid]=await conn.query(
          "SELECT COALESCE(SUM(CASE WHEN kind='REFUND' THEN -amount_f ELSE amount_f END),0) AS total "+
          "FROM payments WHERE (sale_id=? OR debt_id IN (SELECT id FROM debts WHERE sale_id=?))",
          [saleId,saleId]
        );
        const refundF=Number(paid[0].total);
        assert(refundF>=0&&Number.isSafeInteger(refundF),409,'Montant de remboursement incorrect.');
        if(refundF>0){
          await conn.query(
            "INSERT INTO payments(sale_id,agent_user_id,amount_f,method,kind,request_id) VALUES(?,?,?,?,'REFUND',?)",
            [saleId,sale.agent_user_id,refundF,refundMethod,requestId]
          );
        }
        await conn.query(
          "UPDATE debts SET remaining_amount_f=0,status='CANCELLED' WHERE sale_id=? AND status='OPEN'",[saleId]
        );
        await conn.query(
          "UPDATE sales SET status='CANCELLED',cancelled_at=UTC_TIMESTAMP(),cancelled_by_user_id=?,cancel_reason=? WHERE id=?",
          [req.auth.id,'Retour vérifié - annulation manager',saleId]
        );
        await conn.query("UPDATE items SET state='AVAILABLE',sold_at=NULL,current_sale_id=NULL WHERE id=?",[sale.item_id]);
        await conn.query(
          "UPDATE approvals SET status='APPLIED',applied_at=UTC_TIMESTAMP() WHERE id=?",[approvalId]
        );
        await conn.query(
          "INSERT INTO movements(item_id,actor_user_id,kind,destination_warehouse_id,reference_type,reference_id) VALUES(?,?,?,?,?,?)",
          [sale.item_id,req.auth.id,'SALE_CANCELLED',sale.warehouse_id,'SALE',saleId]
        );
        await audit(conn,req,'SALE_CANCELLED','sales',saleId,{
          itemId:String(sale.item_id),refundF,approvalId,physicalReturnConfirmed:true,
        });
        return {id:saleId,status:'CANCELLED',refundF};
      });
      res.json({sale:outcome});
    }catch(error){next(error);}
  });
  return router;
}
