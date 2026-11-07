import { createHash } from 'node:crypto';
import { Router } from 'express';
import { transaction } from './db.mjs';
import { requireRole } from './auth.mjs';
import { assert, maskImei, positiveId, uniqueIds } from './errors.mjs';

const requestIdValid = value => typeof value==='string' &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
const stableHash = payload => createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const sorted = ids => [...ids].sort((a,b)=>BigInt(a)>BigInt(b)?1:BigInt(a)<BigInt(b)?-1:0);
const sameItems = (a,b) => JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
const log = (conn,actor,action,id,detail) => conn.query(
  'INSERT INTO logs(actor_user_id,action,entity_name,entity_id,details_json) VALUES(?,?,?,?,?)',
  [actor,action,'transfers',id,JSON.stringify(detail)]
);

export function transferRoutes(pool) {
  const router=Router();

  router.get('/',async(req,res,next)=>{
    try{
      const agent=req.auth.role==='agent';
      const [rows]=await pool.query(
        'SELECT tr.id,tr.status,tr.sent_at AS sentAt,u.name AS agentName,'+
        'COUNT(ti.id) AS quantity FROM transfers tr '+
        'JOIN warehouses dest ON dest.id=tr.target_warehouse_id '+
        'JOIN users u ON u.id=dest.agent_user_id '+
        'JOIN transfers_items ti ON ti.transfer_id=tr.id '+
        (agent?'WHERE dest.agent_user_id=? ':'')+
        'GROUP BY tr.id,tr.status,tr.sent_at,u.name ORDER BY tr.sent_at DESC LIMIT 100',
        agent?[req.auth.id]:[]
      );
      res.json({transfers:rows.map(row=>({
        id:String(row.id),status:row.status,sentAt:row.sentAt,
        agentName:row.agentName,quantity:Number(row.quantity),
      }))});
    }catch(error){next(error);}
  });

  router.get('/pending',requireRole('agent'),async(req,res,next)=>{
    try{
      const [rows]=await pool.query(
        "SELECT tr.id AS transferId,tr.sent_at AS sentAt,s.name AS sourceName,"+
        "i.id AS itemId,i.imei,p.name AS productName "+
        "FROM transfers tr JOIN warehouses dest ON dest.id=tr.target_warehouse_id "+
        "JOIN warehouses s ON s.id=tr.source_warehouse_id "+
        "JOIN transfers_items ti ON ti.transfer_id=tr.id "+
        "JOIN items i ON i.id=ti.item_id JOIN products p ON p.id=i.product_id "+
        "WHERE dest.agent_user_id=? AND tr.status='IN_TRANSIT' "+
        "ORDER BY tr.sent_at,ti.id",
        [req.auth.id]
      );
      const grouped=new Map();
      for(const row of rows){
        const id=String(row.transferId);
        if(!grouped.has(id))grouped.set(id,{
          id,source:row.sourceName,sentAt:row.sentAt,items:[],
        });
        grouped.get(id).items.push({
          id:String(row.itemId),imeiMasked:maskImei(row.imei),productName:row.productName,
        });
      }
      res.json({transfers:[...grouped.values()]});
    }catch(error){next(error);}
  });

  router.get('/:id',async(req,res,next)=>{
    try{
      const id=positiveId(req.params.id);
      assert(id,422,'Numéro de transfert invalide.');
      const [rows]=await pool.query(
        'SELECT tr.id,tr.status,tr.sent_at AS sentAt,tr.received_at AS receivedAt,'+
        'w.name AS targetName,src.name AS sourceName,w.agent_user_id AS agentId '+
        'FROM transfers tr JOIN warehouses w ON w.id=tr.target_warehouse_id '+
        'JOIN warehouses src ON src.id=tr.source_warehouse_id WHERE tr.id=? LIMIT 1',[id]
      );
      assert(rows.length,404,'Transfert introuvable.');
      const row=rows[0];
      assert(req.auth.role!=='agent'||String(row.agentId)===req.auth.id,403,'Transfert non autorisé.');
      const [items]=await pool.query(
        'SELECT i.id,i.imei,p.name AS productName,i.state FROM transfers_items ti '+
        'JOIN items i ON i.id=ti.item_id JOIN products p ON p.id=i.product_id '+
        'WHERE ti.transfer_id=? ORDER BY ti.id',[id]
      );
      res.json({transfer:{
        id:String(row.id),status:row.status,sentAt:row.sentAt,receivedAt:row.receivedAt,
        source:row.sourceName,target:row.targetName,
        items:items.map(i=>({id:String(i.id),imeiMasked:maskImei(i.imei),productName:i.productName,state:i.state})),
      }});
    }catch(error){next(error);}
  });

  router.post('/',requireRole('manager','director'),async(req,res,next)=>{
    try{
      const sourceId=positiveId(req.body?.sourceWarehouseId);
      const targetAgentId=positiveId(req.body?.agentId);
      const ids=uniqueIds(req.body?.itemIds,{max:100});
      const requestId=req.body?.requestId;
      assert(sourceId&&targetAgentId&&ids&&requestIdValid(requestId),422,
        'Stock central, agent, IMEI et identifiant de requête valides requis.');
      const normalized={sourceId,targetAgentId,ids:sorted(ids)};
      const hash=stableHash(normalized);
      const outcome=await transaction(pool,async conn=>{
        const [old]=await conn.query(
          'SELECT id,status,payload_hash FROM transfers WHERE created_by_user_id=? AND request_id=? FOR UPDATE',
          [req.auth.id,requestId]
        );
        if(old.length){
          assert(old[0].payload_hash===hash,409,'Identifiant déjà utilisé avec un autre contenu.');
          return {id:String(old[0].id),status:old[0].status,replayed:true};
        }
        const [sources]=await conn.query("SELECT id FROM warehouses WHERE id=? AND kind='CENTRAL' AND active=1 FOR UPDATE",[sourceId]);
        const [targets]=await conn.query(
          "SELECT w.id FROM warehouses w JOIN users u ON u.id=w.agent_user_id "+
          "JOIN roles r ON r.id=u.role_id AND r.code='agent' "+
          "WHERE w.kind='AGENT' AND w.active=1 AND u.active=1 AND u.id=? FOR UPDATE",
          [targetAgentId]
        );
        assert(sources.length===1&&targets.length===1,404,'Entrepôt central ou agent indisponible.');
        const targetId=String(targets[0].id);
        const [items]=await conn.query(
          'SELECT id,state,warehouse_id FROM items WHERE id IN ('+ids.map(()=>'?').join(',')+') ORDER BY id FOR UPDATE',
          ids
        );
        assert(items.length===ids.length&&items.every(item=>
          item.state==='AVAILABLE'&&String(item.warehouse_id)===sourceId
        ),409,'Un ou plusieurs IMEI sont absents, gelés ou déjà engagés.');
        const [insert]=await conn.query(
          "INSERT INTO transfers(source_warehouse_id,target_warehouse_id,created_by_user_id,request_id,payload_hash,status) "+
          "VALUES(?,?,?,?,?,'IN_TRANSIT')",[sourceId,targetId,req.auth.id,requestId,hash]
        );
        const id=String(insert.insertId);
        for(const itemId of ids)await conn.query(
          'INSERT INTO transfers_items(transfer_id,item_id) VALUES(?,?)',[id,itemId]
        );
        const [updated]=await conn.query(
          "UPDATE items SET state='IN_TRANSIT' WHERE id IN ("+ids.map(()=>'?').join(',')+") "+
          "AND warehouse_id=? AND state='AVAILABLE'",[...ids,sourceId]
        );
        assert(updated.affectedRows===ids.length,409,'Le stock a changé pendant la réservation.');
        await log(conn,req.auth.id,'TRANSFER_SENT',id,{
          sourceWarehouseId:sourceId,targetAgentId,itemIds:ids,
        });
        return {id,status:'IN_TRANSIT',replayed:false};
      });
      res.status(outcome.replayed?200:201).json({transfer:outcome});
    }catch(error){next(error);}
  });

  router.post('/:id/receive',requireRole('agent'),async(req,res,next)=>{
    try{
      const transferId=positiveId(req.params.id);
      const checked=uniqueIds(req.body?.itemIds,{max:100});
      assert(transferId&&checked,422,'Cochez tous les IMEI physiquement reçus.');
      const outcome=await transaction(pool,async conn=>{
        const [rows]=await conn.query(
          'SELECT tr.id,tr.status,tr.source_warehouse_id,tr.target_warehouse_id,w.agent_user_id '+
          'FROM transfers tr JOIN warehouses w ON w.id=tr.target_warehouse_id '+
          'WHERE tr.id=? FOR UPDATE',[transferId]
        );
        assert(rows.length,404,'Transfert introuvable.');
        const tr=rows[0];
        assert(String(tr.agent_user_id)===req.auth.id,403,'Réception réservée au destinataire.');
        const [items]=await conn.query(
          'SELECT item_id FROM transfers_items WHERE transfer_id=? ORDER BY item_id',[transferId]
        );
        const expected=items.map(item=>String(item.item_id));
        assert(sameItems(expected,checked),409,
          'Contrôle physique incomplet. Signalez un écart si un IMEI manque.','RECEIPT_MISMATCH');
        if(tr.status==='RECEIVED')return {id:transferId,status:'RECEIVED',replayed:true};
        assert(tr.status==='IN_TRANSIT',409,'Transfert bloqué ou déjà clôturé.');
        const [stock]=await conn.query(
          'SELECT id,state,warehouse_id FROM items WHERE id IN ('+expected.map(()=>'?').join(',')+') ORDER BY id FOR UPDATE',
          expected
        );
        assert(stock.length===expected.length&&stock.every(item=>
          item.state==='IN_TRANSIT'&&String(item.warehouse_id)===String(tr.source_warehouse_id)
        ),409,'Le stock du transfert n’est plus dans l’état attendu.');
        const [movement]=await conn.query(
          "UPDATE items SET warehouse_id=?,state='AVAILABLE' "+
          'WHERE id IN ('+expected.map(()=>'?').join(',')+") AND state='IN_TRANSIT'",
          [tr.target_warehouse_id,...expected]
        );
        assert(movement.affectedRows===expected.length,409,'Réception partielle refusée.');
        await conn.query(
          "UPDATE transfers SET status='RECEIVED',received_by_user_id=?,received_at=UTC_TIMESTAMP() "+
          'WHERE id=?',[req.auth.id,transferId]
        );
        await log(conn,req.auth.id,'TRANSFER_RECEIVED',transferId,{itemIds:expected,quantity:expected.length});
        return {id:transferId,status:'RECEIVED',replayed:false};
      });
      res.status(200).json({transfer:outcome});
    }catch(error){next(error);}
  });

  router.post('/:id/discrepancy',requireRole('agent'),async(req,res,next)=>{
    try{
      const id=positiveId(req.params.id);
      const present=uniqueIds(req.body?.presentItemIds,{min:0,max:100});
      const reason=typeof req.body?.reason==='string'?req.body.reason.trim():'';
      assert(id&&present&&reason.length>=8&&reason.length<=500,422,
        'Détaillez l’écart constaté et les IMEI physiquement présents.');
      const outcome=await transaction(pool,async conn=>{
        const [rows]=await conn.query(
          'SELECT tr.id,tr.status,w.agent_user_id FROM transfers tr '+
          'JOIN warehouses w ON w.id=tr.target_warehouse_id WHERE tr.id=? FOR UPDATE',[id]
        );
        assert(rows.length,404,'Transfert introuvable.');
        assert(String(rows[0].agent_user_id)===req.auth.id,403,'Seul le destinataire peut signaler cet écart.');
        if(rows[0].status==='DISCREPANCY')return {id,status:'DISCREPANCY',replayed:true};
        assert(rows[0].status==='IN_TRANSIT',409,'Transfert déjà clôturé.');
        const [expectedRows]=await conn.query('SELECT item_id FROM transfers_items WHERE transfer_id=?',[id]);
        const expected=expectedRows.map(row=>String(row.item_id));
        assert(expected.length>0&&present.every(value=>expected.includes(value)),422,'IMEI hors transfert.');
        assert(present.length<expected.length,422,'Tous les IMEI sont présents : validez la réception.');
        const missing=expected.filter(value=>!present.includes(value));
        const [stock]=await conn.query(
          'SELECT id,state FROM items WHERE id IN ('+expected.map(()=>'?').join(',')+') ORDER BY id FOR UPDATE',expected
        );
        assert(stock.length===expected.length&&stock.every(item=>item.state==='IN_TRANSIT'),
          409,'Le stock n’est plus en transit.');
        // Quarantine ALL items: a missing unit must NEVER be marked saleable again.
        const [updated]=await conn.query(
          "UPDATE items SET state='HOLD' WHERE id IN ("+expected.map(()=>'?').join(',')+") AND state='IN_TRANSIT'",expected
        );
        assert(updated.affectedRows===expected.length,409,'Gel incomplet.');
        await conn.query(
          "UPDATE transfers SET status='DISCREPANCY',discrepancy_reason=?,received_by_user_id=? WHERE id=?",
          [reason,req.auth.id,id]
        );
        await log(conn,req.auth.id,'TRANSFER_DISCREPANCY',id,{
          reason,presentItemIds:present,missingItemIds:missing,
          requiresManagerReview:true,
        });
        return {id,status:'DISCREPANCY',replayed:false,missingCount:missing.length};
      });
      res.json({transfer:outcome});
    }catch(error){next(error);}
  });
  router.post('/:id/resolve',requireRole('manager','director'),async(req,res,next)=>{
    try{
      const transferId=positiveId(req.params.id);
      const verified=uniqueIds(req.body?.verifiedItemIds,{min:0,max:100});
      const reason=typeof req.body?.reason==='string'?req.body.reason.trim():'';
      assert(transferId&&verified!==null&&reason.length>=8&&reason.length<=500,422,
        'Indiquez les IMEI physiquement revenus au Central et un motif de décision.');
      const outcome=await transaction(pool,async conn=>{
        const [transfers]=await conn.query(
          'SELECT tr.id,tr.status,tr.source_warehouse_id,tr.target_warehouse_id '+
          'FROM transfers tr WHERE tr.id=? FOR UPDATE',[transferId]
        );
        const tr=transfers[0];
        assert(tr&&tr.status==='DISCREPANCY',409,'Aucun écart actif à réconcilier pour ce transfert.');
        const [related]=await conn.query(
          'SELECT ti.item_id FROM transfers_items ti WHERE ti.transfer_id=? ORDER BY ti.item_id FOR UPDATE',
          [transferId]
        );
        const expected=related.map(row=>String(row.item_id));
        assert(expected.length>0&&verified.every(id=>expected.includes(id)),422,
          'IMEI non contenu dans ce transfert.');
        const [stock]=await conn.query(
          'SELECT id,warehouse_id,state FROM items WHERE id IN ('+
          expected.map(()=>'?').join(',')+') ORDER BY id FOR UPDATE',expected
        );
        assert(stock.length===expected.length&&stock.every(item=>
          item.state==='HOLD'&&String(item.warehouse_id)===String(tr.source_warehouse_id)
        ),409,'Un ou plusieurs articles ne sont plus en quarantaine au Central.');
        if(verified.length){
          const [updated]=await conn.query(
            "UPDATE items SET state='AVAILABLE' WHERE id IN ("+
            verified.map(()=>'?').join(',')+") AND warehouse_id=? AND state='HOLD'",
            [...verified,tr.source_warehouse_id]
          );
          assert(updated.affectedRows===verified.length,409,'Restitution incomplète.');
          for(const id of verified){
            await conn.query(
              'INSERT INTO movements(item_id,actor_user_id,kind,origin_warehouse_id,destination_warehouse_id,reference_type,reference_id) VALUES(?,?,?,?,?,?,?)',
              [id,req.auth.id,'TRANSFER_RETURNED',tr.target_warehouse_id,tr.source_warehouse_id,'TRANSFER',transferId]
            );
          }
        }
        const missing=expected.filter(id=>!verified.includes(id));
        const status=missing.length?'CLOSED_WITH_DISCREPANCY':'RETURNED';
        await conn.query('UPDATE transfers SET status=?,discrepancy_reason=? WHERE id=?',
          [status,reason,transferId]);
        await log(conn,req.auth.id,'TRANSFER_RECONCILED',transferId,{
          verifiedReturnedItemIds:verified,missingItemIds:missing,
          reason,status,missingRemainOnHold:true,
        });
        return {id:transferId,status,returnedCount:verified.length,missingCount:missing.length};
      });
      res.json({transfer:outcome});
    }catch(error){next(error);}
  });

  return router;
}
