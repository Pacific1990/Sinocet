import { Router } from 'express';
import { transaction } from './db.mjs';
import { requireRole } from './auth.mjs';
import { assert, positiveId, uniqueIds } from './errors.mjs';
import { audit, idOrFail, textValue } from './utils.mjs';

export function inventoryRoutes(pool){
  const router=Router();
  router.use(requireRole('manager','director'));

  router.get('/agents',async(req,res,next)=>{
    try{
      const [rows]=await pool.query(
        "SELECT w.id AS warehouseId,w.name AS stockName,w.frozen,u.id AS agentId,u.name AS agentName,"+
        "(SELECT MAX(opened_at) FROM inventories v WHERE v.warehouse_id=w.id) AS lastInventory,"+
        "(SELECT COUNT(*) FROM items i WHERE i.warehouse_id=w.id AND i.state IN ('AVAILABLE','HOLD')) AS currentCount "+
        "FROM warehouses w JOIN users u ON u.id=w.agent_user_id "+
        "WHERE w.kind='AGENT' ORDER BY u.name"
      );
      res.json({agents:rows.map(row=>({
        warehouseId:String(row.warehouseId),stockName:row.stockName,agentId:String(row.agentId),
        agentName:row.agentName,frozen:Boolean(row.frozen),lastInventory:row.lastInventory,
        currentCount:Number(row.currentCount),
      }))});
    }catch(error){next(error);}
  });

  router.get('/',async(_req,res,next)=>{
    try{
      const [rows]=await pool.query(
        "SELECT inv.id,inv.warehouse_id,inv.status,inv.opened_at,inv.finished_at,inv.note,"+
        "w.name AS warehouseName,u.name AS agentName "+
        "FROM inventories inv JOIN warehouses w ON w.id=inv.warehouse_id "+
        "JOIN users u ON u.id=w.agent_user_id ORDER BY inv.opened_at DESC LIMIT 100"
      );
      res.json({inventories:rows.map(row=>({
        id:String(row.id),warehouseId:String(row.warehouse_id),warehouseName:row.warehouseName,
        agentName:row.agentName,status:row.status,openedAt:row.opened_at,
        finishedAt:row.finished_at,note:row.note,
      }))});
    }catch(error){next(error);}
  });

  router.post('/start',async(req,res,next)=>{
    try{
      const warehouseId=idOrFail(req.body?.warehouseId,'Entrepôt agent');
      const result=await transaction(pool,async conn=>{
        const [warehouses]=await conn.query(
          "SELECT id,kind,frozen,active FROM warehouses WHERE id=? FOR UPDATE",[warehouseId]
        );
        const w=warehouses[0];
        assert(w&&w.kind==='AGENT'&&w.active===1&&!w.frozen,
          409,'Agent indisponible ou stock déjà gelé.');
        const [inProgress]=await conn.query(
          "SELECT id FROM inventories WHERE warehouse_id=? AND status='IN_PROGRESS' LIMIT 1",[warehouseId]
        );
        assert(!inProgress.length,409,'Un inventaire existe déjà pour cet agent.');
        await conn.query('UPDATE warehouses SET frozen=1 WHERE id=?',[warehouseId]);
        const [invent]=await conn.query(
          'INSERT INTO inventories(warehouse_id,started_by_user_id) VALUES(?,?)',
          [warehouseId,req.auth.id]
        );
        const [lines]=await conn.query(
          "SELECT product_id,COUNT(*) AS quantity FROM items WHERE warehouse_id=? "+
          "AND state IN ('AVAILABLE','HOLD') GROUP BY product_id ORDER BY product_id",[warehouseId]
        );
        for(const line of lines){
          await conn.query(
            'INSERT INTO inventories_lines(inventory_id,product_id,expected_count) VALUES(?,?,?)',
            [invent.insertId,line.product_id,line.quantity]
          );
        }
        await audit(conn,req,'INVENTORY_STARTED','inventories',invent.insertId,{
          warehouseId,expectedProducts:lines.length,before:'ACTIVE',after:'FROZEN',
        });
        return {id:String(invent.insertId),status:'IN_PROGRESS',warehouseId,lines:lines.length};
      });
      res.status(201).json({inventory:result});
    }catch(error){next(error);}
  });

  router.get('/:id',async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Inventaire');
      const [inventories]=await pool.query(
        'SELECT inv.id,inv.status,inv.note,inv.opened_at,inv.finished_at,w.name AS warehouseName,'+
        'w.frozen,inv.reconciled_at AS reconciledAt,u.name AS agentName FROM inventories inv JOIN warehouses w ON w.id=inv.warehouse_id '+
        'JOIN users u ON u.id=w.agent_user_id WHERE inv.id=?',[id]
      );
      assert(inventories.length,404,'Inventaire introuvable.');
      const [lines]=await pool.query(
        'SELECT il.product_id,p.name,il.expected_count,il.counted_count FROM inventories_lines il '+
        'JOIN products p ON p.id=il.product_id WHERE il.inventory_id=? ORDER BY p.name',[id]
      );
      res.json({inventory:{
        id, status:inventories[0].status,warehouseName:inventories[0].warehouseName,
        agentName:inventories[0].agentName,frozen:Boolean(inventories[0].frozen),
        reconciledAt:inventories[0].reconciledAt,
        openedAt:inventories[0].opened_at,finishedAt:inventories[0].finished_at,
        note:inventories[0].note,
        lines:lines.map(l=>({
          productId:String(l.product_id),name:l.name,expected:Number(l.expected_count),
          counted:l.counted_count===null?null:Number(l.counted_count),
          difference:l.counted_count===null?null:Number(l.counted_count)-Number(l.expected_count),
        })),
      }});
    }catch(error){next(error);}
  });

  router.post('/:id/close',async(req,res,next)=>{
    try {
      const id=idOrFail(req.params.id,'Inventaire');
      const counts=req.body?.counts;
      assert(Array.isArray(counts)&&counts.length<=500,422,'Comptage invalide.');
      const normalized=counts.map(row=>({
        productId:idOrFail(row?.productId,'Produit'),
        counted:row?.counted,
      }));
      assert(normalized.every(r=>Number.isInteger(r.counted)&&r.counted>=0&&r.counted<=100000)&&
        new Set(normalized.map(r=>r.productId)).size===normalized.length,
        422,'Quantités négatives, répétées ou invalides.');
      const note=req.body?.note?textValue(req.body.note,2,500):null;
      const outcome=await transaction(pool,async conn=>{
        const [inv]=await conn.query('SELECT id,warehouse_id,status FROM inventories WHERE id=? FOR UPDATE',[id]);
        assert(inv.length&&inv[0].status==='IN_PROGRESS',409,'Inventaire déjà clôturé ou absent.');
        const warehouseId=String(inv[0].warehouse_id);
        const [warehouses]=await conn.query('SELECT id,frozen FROM warehouses WHERE id=? FOR UPDATE',[warehouseId]);
        assert(warehouses.length&&warehouses[0].frozen===1,409,'Le gel du stock a été modifié.');
        const [lines]=await conn.query('SELECT product_id,expected_count FROM inventories_lines WHERE inventory_id=? FOR UPDATE',[id]);
        assert(lines.length===normalized.length,422,'Tous les produits doivent être comptés.');
        const map=new Map(normalized.map(r=>[r.productId,r.counted]));
        assert(lines.every(row=>map.has(String(row.product_id))),422,'Produit non présent à l’inventaire.');
        let discrepancy=0;
        for(const row of lines){
          const counted=map.get(String(row.product_id));
          discrepancy+=Math.abs(counted-Number(row.expected_count));
          await conn.query('UPDATE inventories_lines SET counted_count=? WHERE inventory_id=? AND product_id=?',
            [counted,id,row.product_id]);
        }
        await conn.query("UPDATE inventories SET status='CLOSED',finished_by_user_id=?,finished_at=UTC_TIMESTAMP(),note=? WHERE id=?",
          [req.auth.id,note,id]);
        if(discrepancy===0)await conn.query('UPDATE warehouses SET frozen=0 WHERE id=?',[warehouseId]);
        await audit(conn,req,'INVENTORY_CLOSED','inventories',id,{
          warehouseId,discrepancy,frozen:discrepancy>0,
        });
        return {id,status:'CLOSED',discrepancy,frozen:discrepancy>0};
      });
      res.json({inventory:outcome});
    }catch(error){next(error);}
  });

  router.get('/:id/items',async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Inventaire');
      const [rows]=await pool.query(
        'SELECT inv.warehouse_id,inv.status FROM inventories inv WHERE inv.id=?',[id]
      );
      assert(rows.length,404,'Inventaire inconnu.');
      const [stock]=await pool.query(
        "SELECT i.id,i.product_id,p.name AS productName,i.imei,i.state "+
        "FROM items i JOIN products p ON p.id=i.product_id "+
        "WHERE i.warehouse_id=? AND i.state IN ('AVAILABLE','HOLD') "+
        "ORDER BY p.name,i.id LIMIT 5000",[rows[0].warehouse_id]
      );
      res.json({items:stock.map(r=>({
        id:String(r.id),productId:String(r.product_id),
        productName:r.productName,imeiMasked:'•••'+String(r.imei).slice(-5),state:r.state,
      }))});
    }catch(error){next(error);}
  });

  router.post('/:id/reconcile',async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Inventaire');
      const verified=uniqueIds(req.body?.verifiedItemIds,{min:0,max:5000});
      const reason=textValue(req.body?.reason,8,500);
      assert(verified!==null,422,'Sélectionnez les IMEI physiquement présents.');
      const outcome=await transaction(pool,async conn=>{
        const [inventories]=await conn.query(
          'SELECT id,warehouse_id,status,reconciled_at FROM inventories WHERE id=? FOR UPDATE',[id]
        );
        const inventory=inventories[0];
        assert(inventory&&inventory.status==='CLOSED'&&!inventory.reconciled_at,409,
          'Inventaire non clôturé ou déjà réconcilié.');
        const warehouseId=String(inventory.warehouse_id);
        const [warehouses]=await conn.query(
          "SELECT id,frozen FROM warehouses WHERE id=? AND kind='AGENT' FOR UPDATE",[warehouseId]
        );
        assert(warehouses.length&&Boolean(warehouses[0].frozen),409,'Stock non gelé.');
        const [open]=await conn.query(
          "SELECT id FROM inventories WHERE warehouse_id=? AND status='IN_PROGRESS' LIMIT 1",[warehouseId]
        );
        assert(open.length===0,409,'Autre inventaire ouvert sur ce stock.');
        const [lines]=await conn.query(
          'SELECT product_id,expected_count,counted_count FROM inventories_lines WHERE inventory_id=? FOR UPDATE',[id]
        );
        assert(lines.every(line=>line.counted_count!==null),409,'Comptage non renseigné.');
        const [items]=await conn.query(
          "SELECT id,product_id,state FROM items WHERE warehouse_id=? AND state IN ('AVAILABLE','HOLD') "+
          "ORDER BY id FOR UPDATE",[warehouseId]
        );
        const ids=new Set(items.map(r=>String(r.id)));
        assert(verified.every(id=>ids.has(id)),422,'IMEI hors de ce stock.');
        const selected=new Set(verified);
        const presentByProduct=new Map();
        for(const item of items){
          if(selected.has(String(item.id))){
            const product=String(item.product_id);
            presentByProduct.set(product,(presentByProduct.get(product)||0)+1);
          }
        }
        for(const line of lines){
          assert((presentByProduct.get(String(line.product_id))||0)===Number(line.counted_count),
            409,'Le détail physique par IMEI ne correspond pas au comptage déclaré.');
        }
        assert(selected.size===lines.reduce((sum,line)=>sum+Number(line.counted_count),0),
          409,'Nombre d’IMEI physiques incohérent.');
        const missing=items.filter(item=>!selected.has(String(item.id)));
        for(const item of missing){
          if(item.state==='AVAILABLE'){
            const [updated]=await conn.query(
              "UPDATE items SET state='HOLD' WHERE id=? AND warehouse_id=? AND state='AVAILABLE'",
              [item.id,warehouseId]
            );
            assert(updated.affectedRows===1,409,'Stock modifié pendant la vérification.');
          }
        }
        await conn.query(
          "UPDATE inventories SET reconciled_at=UTC_TIMESTAMP(),reconciled_by_user_id=?,note=CONCAT(COALESCE(note,''),' | Réconciliation: ',?) WHERE id=?",
          [req.auth.id,reason,id]
        );
        await conn.query('UPDATE warehouses SET frozen=0 WHERE id=?',[warehouseId]);
        await audit(conn,req,'INVENTORY_RECONCILED','inventories',id,{
          warehouseId,verifiedItemIds:verified,
          missingItemIds:missing.map(item=>String(item.id)),
          missingRemainOnHold:true,reason,
        });
        return {id,status:'RECONCILED',verifiedCount:verified.length,
          missingCount:missing.length,unfrozen:true};
      });
      res.json({inventory:outcome});
    }catch(error){next(error);}
  });

  router.post('/warehouses/:id/freeze',async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Entrepôt agent');
      const desired=req.body?.frozen;
      assert(typeof desired==='boolean',422,'État de gel invalide.');
      const reason=textValue(req.body?.reason,8,500);
      const result=await transaction(pool,async conn=>{
        const [rows]=await conn.query(
          "SELECT id,frozen FROM warehouses WHERE id=? AND kind='AGENT' FOR UPDATE",[id]
        );
        assert(rows.length,404,'Stock agent introuvable.');
        const previous=Boolean(rows[0].frozen);
        const [open]=await conn.query(
          "SELECT id FROM inventories WHERE warehouse_id=? AND status='IN_PROGRESS' LIMIT 1",[id]
        );
        assert(desired||!open.length,409,'Inventaire en cours : dégel interdit.');
        if(!desired){
          const [unresolved]=await conn.query(
            "SELECT inv.id FROM inventories inv WHERE inv.warehouse_id=? "+
            "AND inv.status='CLOSED' AND inv.reconciled_at IS NULL "+
            "AND EXISTS(SELECT 1 FROM inventories_lines l WHERE l.inventory_id=inv.id "+
            "AND l.counted_count<>l.expected_count) LIMIT 1",
            [id]
          );
          assert(!unresolved.length,409,
            'Écart d’inventaire non réconcilié : vérifiez les IMEI et gardez les manquants gelés.');
        }

        if(previous!==desired)await conn.query('UPDATE warehouses SET frozen=? WHERE id=?',
          [desired?1:0,id]);
        await audit(conn,req,desired?'STOCK_FROZEN':'STOCK_UNFROZEN','warehouses',id,{
          before:previous,after:desired,reason,
        });
        return {id,frozen:desired};
      });
      res.json({warehouse:result});
    }catch(error){next(error);}
  });

  return router;
}
