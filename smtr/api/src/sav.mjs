import { Router } from 'express';
import { transaction } from './db.mjs';
import { requireRole } from './auth.mjs';
import { assert, maskImei } from './errors.mjs';
import { audit, businessDay, choice, idOrFail, textValue, uuid } from './utils.mjs';

export function savRoutes(pool){
  const router=Router();

  router.get('/',async(req,res,next)=>{
    try{
      const agent=req.auth.role==='agent';
      const [rows]=await pool.query(
        "SELECT sc.id,sc.sale_id,sc.item_id,sc.defect,sc.resolution,sc.status,sc.created_at,"+
        "sc.resolved_at,sc.replacement_item_id,c.name AS customer,u.name AS agent,p.name AS product,i.imei "+
        "FROM sav_cases sc JOIN sales s ON s.id=sc.sale_id JOIN items i ON i.id=sc.item_id "+
        "JOIN products p ON p.id=i.product_id JOIN users u ON u.id=sc.agent_user_id "+
        "LEFT JOIN customers c ON c.id=sc.customer_id "+
        (agent?"WHERE sc.agent_user_id=? ":"")+
        "ORDER BY sc.created_at DESC LIMIT 250",
        agent?[req.auth.id]:[]
      );
      res.json({cases:rows.map(row=>({
        id:String(row.id),saleId:String(row.sale_id),itemId:String(row.item_id),
        customer:row.customer||'Client comptant',agent:row.agent,product:row.product,
        imeiMasked:maskImei(row.imei),defect:row.defect,resolution:row.resolution,
        status:row.status,createdAt:row.created_at,resolvedAt:row.resolved_at,
        replacementItemId:row.replacement_item_id?String(row.replacement_item_id):null,
      }))});
    }catch(error){next(error);}
  });

  router.get('/warehouse',requireRole('manager','director'),async(_req,res,next)=>{
    try{
      const [rows]=await pool.query(
        "SELECT sc.id AS caseId,i.id AS itemId,i.imei,p.name AS product,sc.defect,sc.status,"+
        "sc.resolution,sc.created_at,sc.sale_id "+
        "FROM sav_cases sc JOIN items i ON i.id=sc.item_id "+
        "JOIN products p ON p.id=i.product_id JOIN warehouses w ON w.id=i.warehouse_id "+
        "WHERE w.kind='SAV' AND i.state IN ('SAV','HOLD') AND sc.status IN ('OPEN','IN_PROGRESS','RESOLVED') ORDER BY sc.created_at DESC LIMIT 300"
      );
      res.json({items:rows.map(row=>({
        id:String(row.itemId),caseId:String(row.caseId),saleId:String(row.sale_id),
        imeiMasked:maskImei(row.imei),product:row.product,defect:row.defect,
        status:row.status,resolution:row.resolution,enteredAt:row.created_at,
      }))});
    }catch(error){next(error);}
  });

  router.post('/',requireRole('agent'),async(req,res,next)=>{
    try{
      const saleId=idOrFail(req.body?.saleId,'Vente');
      const defect=textValue(req.body?.defect,10,600);
      assert(req.body?.factoryDefectConfirmed===true,422,
        'Le SAV concerne exclusivement les retours pour défaut d’usine.');
      const id=await transaction(pool,async conn=>{
        const [sales]=await conn.query(
          'SELECT s.id,s.status,s.customer_id,i.id AS item_id,i.state,i.warehouse_id,w.agent_user_id '+
          'FROM sales s JOIN items i ON i.current_sale_id=s.id JOIN warehouses w ON w.id=i.warehouse_id '+
          'WHERE s.id=? AND s.agent_user_id=? FOR UPDATE',
          [saleId,req.auth.id]
        );
        const sale=sales[0];
        assert(sale&&sale.status==='COMPLETED'&&sale.state==='SOLD'&&
          String(sale.agent_user_id)===req.auth.id,409,'Vente ou IMEI indisponible pour retour SAV.');
        const [sav]=await conn.query(
          "SELECT id FROM warehouses WHERE kind='SAV' AND active=1 ORDER BY id LIMIT 1 FOR UPDATE"
        );
        assert(sav.length===1,409,'Entrepôt virtuel SAV non encore configuré.');
        const [existing]=await conn.query(
          "SELECT id FROM sav_cases WHERE item_id=? AND status IN ('OPEN','IN_PROGRESS','RESOLVED') LIMIT 1",
          [sale.item_id]
        );
        assert(!existing.length,409,'Un dossier SAV existe déjà pour cet appareil.');
        const [r]=await conn.query(
          'INSERT INTO sav_cases(sale_id,item_id,customer_id,agent_user_id,defect,origin_warehouse_id,sav_warehouse_id) '+
          'VALUES(?,?,?,?,?,?,?)',
          [saleId,sale.item_id,sale.customer_id,req.auth.id,defect,sale.warehouse_id,sav[0].id]
        );
        await conn.query(
          "UPDATE items SET warehouse_id=?,state='SAV' WHERE id=?",
          [sav[0].id,sale.item_id]
        );
        await conn.query(
          'INSERT INTO movements(item_id,actor_user_id,kind,origin_warehouse_id,destination_warehouse_id,reference_type,reference_id) '+
          'VALUES(?,?,?,?,?,?,?)',
          [sale.item_id,req.auth.id,'SAV_RECEIVED',sale.warehouse_id,sav[0].id,'SAV',r.insertId]
        );
        await audit(conn,req,'SAV_OPENED','sav_cases',r.insertId,{
          saleId,defect,from:String(sale.warehouse_id),to:String(sav[0].id),
        });
        return String(r.insertId);
      });
      res.status(201).json({case:{id,status:'OPEN'}});
    }catch(error){next(error);}
  });

  router.post('/:id/start',requireRole('manager','director'),async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Dossier SAV');
      const result=await transaction(pool,async conn=>{
        const [rows]=await conn.query('SELECT id,status FROM sav_cases WHERE id=? FOR UPDATE',[id]);
        assert(rows.length&&rows[0].status==='OPEN',409,'Dossier non ouvert.');
        await conn.query("UPDATE sav_cases SET status='IN_PROGRESS',manager_user_id=? WHERE id=?",
          [req.auth.id,id]);
        await audit(conn,req,'SAV_STARTED','sav_cases',id,{before:'OPEN',after:'IN_PROGRESS'});
        return {id,status:'IN_PROGRESS'};
      });
      res.json({case:result});
    }catch(error){next(error);}
  });

  router.post('/:id/resolve',requireRole('manager','director'),async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Dossier SAV');
      const approvalId=idOrFail(req.body?.approvalId,'Validation SAV');
      const replacementId=req.body?.replacementItemId?idOrFail(req.body.replacementItemId,'IMEI de remplacement'):null;
      const refundMethod=req.body?.refundMethod || null;
      const refundConfirmed=req.body?.refundConfirmed===true;
      const refundReference=req.body?.refundReference?textValue(req.body.refundReference,3,120):null;
      const requestId=req.body?.requestId?uuid(req.body.requestId):null;
      const outcome=await transaction(pool,async conn=>{
        const [approved]=await conn.query(
          "SELECT status,resolution,sav_case_id FROM approvals WHERE id=? AND kind='SAV_RESOLUTION' FOR UPDATE",
          [approvalId]
        );
        assert(approved[0]&&approved[0].status==='APPROVED'&&
          String(approved[0].sav_case_id)===id,409,'Résolution SAV non approuvée.');
        const type=approved[0].resolution;
        const [cases]=await conn.query(
          'SELECT sc.*,s.status AS saleStatus,s.agent_user_id,s.paid_amount_f '+
          'FROM sav_cases sc JOIN sales s ON s.id=sc.sale_id WHERE sc.id=? FOR UPDATE',[id]
        );
        const sc=cases[0];
        assert(sc&&['OPEN','IN_PROGRESS'].includes(sc.status),409,'Dossier déjà résolu.');
        const [faulty]=await conn.query(
          'SELECT warehouse_id,state FROM items WHERE id=? FOR UPDATE',[sc.item_id]
        );
        assert(faulty.length&&faulty[0].state==='SAV'&&
          String(faulty[0].warehouse_id)===String(sc.sav_warehouse_id),409,
          'Le défaut n’est plus isolé en entrepôt SAV.');
        let replacement=null,refundF=0;
        if(type==='REPAIR'){
          await conn.query("UPDATE items SET state='HOLD' WHERE id=?",[sc.item_id]);
        }
        if(type==='EXCHANGE'){
          assert(replacementId&&replacementId!==String(sc.item_id),422,
            'Un IMEI de remplacement distinct est requis.');
          const [newItems]=await conn.query(
            "SELECT i.id,i.state,i.warehouse_id,w.kind FROM items i "+
            "JOIN warehouses w ON w.id=i.warehouse_id WHERE i.id=? FOR UPDATE",[replacementId]
          );
          const target=newItems[0];
          assert(target&&target.state==='AVAILABLE'&&target.kind==='CENTRAL',409,
            'Remplacement absent du stock central vendable.');
          await conn.query('UPDATE items SET current_sale_id=NULL WHERE id=?',[sc.item_id]);
          await conn.query("UPDATE items SET state='SOLD',warehouse_id=?,sold_at=UTC_TIMESTAMP(),current_sale_id=? WHERE id=?",
            [sc.origin_warehouse_id,sc.sale_id,replacementId]);
          await conn.query(
            'INSERT INTO movements(item_id,actor_user_id,kind,origin_warehouse_id,destination_warehouse_id,reference_type,reference_id) VALUES(?,?,?,?,?,?,?)',
            [replacementId,req.auth.id,'SAV_EXCHANGE',target.warehouse_id,sc.origin_warehouse_id,'SAV',id]
          );
          replacement=replacementId;
        }
        if(type==='REFUND'){
          assert(refundConfirmed&&refundReference&&requestId,422,
            'Confirmez le remboursement réellement effectué avec sa référence.');
          choice(refundMethod,['CASH','MOBILE_MONEY','TRANSFER']);
          // Serialize with the seller's daily closure and with all other operations.
          const [agent]=await conn.query('SELECT id FROM users WHERE id=? FOR UPDATE',[sc.agent_user_id]);
          assert(agent.length,409,'Agent du dossier manquant.');
          const [closure]=await conn.query('SELECT id FROM cash_closures WHERE agent_user_id=? AND business_day=?',
            [sc.agent_user_id,businessDay()]);
          assert(!closure.length,409,'Caisse déjà clôturée; remboursement comptable interdit ce jour.');
          const [sale]=await conn.query('SELECT id,status FROM sales WHERE id=? FOR UPDATE',[sc.sale_id]);
          assert(sale[0]&&sale[0].status==='COMPLETED',409,'Vente déjà annulée.');
          const [prior]=await conn.query(
            'SELECT id FROM payments WHERE agent_user_id=? AND request_id=?',[sc.agent_user_id,requestId]
          );
          assert(!prior.length,409,'Référence de remboursement déjà utilisée.');
          const [paid]=await conn.query(
            "SELECT COALESCE(SUM(CASE WHEN kind='REFUND' THEN -amount_f ELSE amount_f END),0) AS total "+
            "FROM payments WHERE sale_id=? OR debt_id IN (SELECT id FROM debts WHERE sale_id=?)",
            [sc.sale_id,sc.sale_id]
          );
          refundF=Number(paid[0].total);
          assert(Number.isSafeInteger(refundF)&&refundF>=0,409,'Solde historique incorrect.');
          if(refundF)await conn.query(
            "INSERT INTO payments(sale_id,agent_user_id,amount_f,method,kind,reference,request_id) VALUES(?,?,?,?,'REFUND',?,?)",
            [sc.sale_id,sc.agent_user_id,refundF,refundMethod,refundReference,requestId]
          );
          await conn.query("UPDATE debts SET remaining_amount_f=0,status='CANCELLED' WHERE sale_id=? AND status='OPEN'",
            [sc.sale_id]);
          await conn.query(
            "UPDATE sales SET status='CANCELLED',cancelled_at=UTC_TIMESTAMP(),cancelled_by_user_id=?,cancel_reason='Remboursement SAV' WHERE id=?",
            [req.auth.id,sc.sale_id]
          );
        }
        if(type==='REFUND')await conn.query('UPDATE items SET current_sale_id=NULL WHERE id=?',[sc.item_id]);
        await conn.query(
          "UPDATE sav_cases SET resolution=?,status='RESOLVED',manager_user_id=?,resolved_at=UTC_TIMESTAMP(),replacement_item_id=? WHERE id=?",
          [type,req.auth.id,replacement,id]
        );
        await conn.query("UPDATE approvals SET status='APPLIED',applied_at=UTC_TIMESTAMP() WHERE id=?",[approvalId]);
        await audit(conn,req,'SAV_RESOLVED','sav_cases',id,{
          type,replacementItemId:replacement,refundF,refundReference,
          oldItemState:type==='REPAIR'?'HOLD':'SAV',
        });
        return {id,status:'RESOLVED',resolution:type,replacementItemId:replacement,refundF};
      });
      res.json({case:outcome});
    }catch(error){next(error);}
  });

  router.post('/:id/release',requireRole('manager','director'),async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Dossier SAV');
      const centralId=idOrFail(req.body?.centralWarehouseId,'Stock central');
      assert(req.body?.repairVerified===true,422,'Réparation et contrôle physique à confirmer.');
      const outcome=await transaction(pool,async conn=>{
        const [cases]=await conn.query('SELECT * FROM sav_cases WHERE id=? FOR UPDATE',[id]);
        const c=cases[0];
        assert(c&&c.status==='RESOLVED'&&c.resolution==='REPAIR',409,
          'Seule une réparation résolue peut être réintégrée.');
        const [items]=await conn.query('SELECT id,state,warehouse_id FROM items WHERE id=? FOR UPDATE',[c.item_id]);
        assert(items.length&&items[0].state==='HOLD'&&
          String(items[0].warehouse_id)===String(c.sav_warehouse_id),409,
          'Appareil non isolé en attente de remise en stock.');
        const [warehouses]=await conn.query(
          "SELECT id FROM warehouses WHERE id=? AND kind='CENTRAL' AND active=1 FOR UPDATE",[centralId]
        );
        assert(warehouses.length,404,'Dépôt central introuvable.');
        await conn.query(
          "UPDATE items SET state='AVAILABLE',warehouse_id=?,sold_at=NULL,current_sale_id=NULL WHERE id=?",[centralId,c.item_id]
        );
        await conn.query(
          "UPDATE sav_cases SET status='RELEASED',returned_to_stock_at=UTC_TIMESTAMP() WHERE id=?",[id]
        );
        await conn.query(
          "INSERT INTO movements(item_id,actor_user_id,kind,origin_warehouse_id,destination_warehouse_id,reference_type,reference_id) VALUES(?,?,?,?,?,?,?)",
          [c.item_id,req.auth.id,'SAV_RELEASED',c.sav_warehouse_id,centralId,'SAV',id]
        );
        await audit(conn,req,'SAV_RELEASED','sav_cases',id,{centralId,repairVerified:true});
        return {id,status:'RELEASED',centralWarehouseId:centralId};
      });
      res.json({case:outcome});
    }catch(error){next(error);}
  });

  return router;
}
