import { Router } from 'express';
import { transaction } from './db.mjs';
import { requireRole } from './auth.mjs';
import { assert, HttpError, maskImei, positiveId } from './errors.mjs';

const clean = (value, max = 150) =>
  typeof value==='string' && value.trim().length <= max ? value.trim() : '';
const stockState = (quantity, threshold) => quantity < threshold
  ? 'Sous le seuil' : threshold > 0 && quantity <= threshold + 5 ? 'Proche du seuil' : 'Suffisant';

export function stockRoutes(pool) {
  const router=Router();
  router.get('/',async(req,res,next)=>{
    try {
      const role=req.auth.role;
      const scopeSql=role==='agent'
        ? 'w.kind = \'AGENT\' AND w.agent_user_id = ?'
        : 'w.kind = \'CENTRAL\'';
      const params=role==='agent'?[req.auth.id]:[];
      // One grouped row per category. Sum product minimums only once per product.
      const [rows]=await pool.query(
        'SELECT q.category AS name,SUM(q.available) AS available,'+
        'SUM(q.minimum_level) AS minimumLevel, GROUP_CONCAT(DISTINCT q.locations SEPARATOR \', \') AS location '+
        'FROM (SELECT p.id,p.category,p.minimum_level,'+
        'SUM(CASE WHEN '+scopeSql+" AND i.state='AVAILABLE' AND w.active=1 THEN 1 ELSE 0 END) AS available,"+
        'GROUP_CONCAT(DISTINCT CASE WHEN '+scopeSql+
        " AND i.state='AVAILABLE' THEN NULLIF(i.location_code,'') ELSE NULL END SEPARATOR ', ') AS locations "+
        'FROM products p LEFT JOIN items i ON i.product_id=p.id '+
        'LEFT JOIN warehouses w ON w.id=i.warehouse_id '+
        "WHERE p.active=1 "+(role==='agent'
          ? ' AND EXISTS (SELECT 1 FROM items own JOIN warehouses w2 ON w2.id=own.warehouse_id WHERE own.product_id=p.id AND w2.agent_user_id=?) '
          : '')+
        'GROUP BY p.id,p.category,p.minimum_level) q GROUP BY q.category ORDER BY q.category',
        [...params,...params,...(role==='agent'?[req.auth.id]:[])]
      );
      res.json({categories:rows.map(row=>({
        id:row.name,name:row.name,available:Number(row.available),
        minimumLevel:Number(row.minimumLevel),
        location:row.location||'—',
        status:stockState(Number(row.available),Number(row.minimumLevel)),
      }))});
    } catch(error){next(error);}
  });
  router.get('/agents',requireRole('manager','director'),async(_req,res,next)=>{
    try {
      const [rows]=await pool.query(
        "SELECT u.id,u.name,w.id AS warehouseId,w.name AS warehouseName FROM users u "+
        "JOIN roles r ON r.id=u.role_id AND r.code='agent' "+
        "JOIN warehouses w ON w.agent_user_id=u.id AND w.kind='AGENT' AND w.active=1 "+
        "WHERE u.active=1 ORDER BY u.name"
      );
      res.json({agents:rows.map(row=>({
        id:String(row.id),name:row.name,warehouseId:String(row.warehouseId),
        warehouseName:row.warehouseName,
      }))});
    }catch(error){next(error);}
  });
  router.get('/central-warehouses',requireRole('manager','director'),async(_req,res,next)=>{
    try{
      const [rows]=await pool.query("SELECT id,name,location FROM warehouses WHERE kind='CENTRAL' AND active=1 ORDER BY name");
      res.json({warehouses:rows.map(row=>({id:String(row.id),name:row.name,location:row.location}))});
    }catch(error){next(error);}
  });
  router.get('/products',requireRole('manager','director'),async(_req,res,next)=>{
    try {
      const [rows]=await pool.query('SELECT id,name,sku,category,minimum_level FROM products WHERE active=1 ORDER BY name');
      res.json({products:rows.map(row=>({id:String(row.id),name:row.name,sku:row.sku,category:row.category,minimumLevel:row.minimum_level}))});
    }catch(error){next(error);}
  });
  router.post('/products',requireRole('manager','director'),async(req,res,next)=>{
    try {
      const {name,category,sku,minimumLevel=0}=req.body||{};
      const label=clean(name,180), group=clean(category,120), code=clean(sku,80);
      assert(label.length>=2&&group.length>=2&&code.length>=2&&
        !/^ramba$/i.test(group)&&Number.isInteger(minimumLevel)&&minimumLevel>=0&&minimumLevel<=100000,
        422,'Produit ou catégorie invalide. Ramba est exclusivement un état SAV.');
      const result=await transaction(pool,async conn=>{
        const [r]=await conn.query(
          'INSERT INTO products(name,category,sku,minimum_level) VALUES(?,?,?,?)',
          [label,group,code,minimumLevel]
        );
        await conn.query('INSERT INTO logs(actor_user_id,action,entity_name,entity_id) VALUES(?,?,?,?)',
          [req.auth.id,'PRODUCT_CREATED','products',r.insertId]);
        return String(r.insertId);
      });
      res.status(201).json({id:result});
    }catch(error){next(error);}
  });
  router.get('/items',requireRole('manager','director'),async(req,res,next)=>{
    try {
      const query=String(req.query.q||'').trim().slice(0,80);
      const warehouseId=positiveId(req.query.warehouseId);
      assert(warehouseId,422,'Stock central requis.');
      const [warehouse]=await pool.query("SELECT id FROM warehouses WHERE id=? AND kind='CENTRAL' AND active=1 LIMIT 1",[warehouseId]);
      assert(warehouse.length>0,404,'Stock central introuvable.');
      const [items]=await pool.query(
        "SELECT i.id,i.imei,i.location_code,p.name AS productName FROM items i "+
        "JOIN products p ON p.id=i.product_id WHERE i.warehouse_id=? AND i.state='AVAILABLE' "+
        "AND (?='' OR i.imei LIKE CONCAT('%',?,'%') OR p.name LIKE CONCAT('%',?,'%')) "+
        'ORDER BY p.name,i.id LIMIT 80',
        [warehouseId,query,query,query]
      );
      res.json({items:items.map(row=>({
        id:String(row.id),imeiMasked:maskImei(row.imei),productName:row.productName,
        location:row.location_code||'—',
      }))});
    }catch(error){next(error);}
  });
  router.post('/receipts',requireRole('manager','director'),async(req,res,next)=>{
    try {
      const warehouseId=positiveId(req.body?.warehouseId);
      const productId=positiveId(req.body?.productId);
      const rows=req.body?.items;
      assert(warehouseId&&productId&&Array.isArray(rows)&&rows.length>=1&&rows.length<=100,
        422,'Choisissez un stock central, un produit et entre 1 et 100 IMEI.');
      const entries=rows.map(row=>({
        imei:String(row?.imei||'').trim(),
        location:clean(row?.location,100)||null,
      }));
      assert(entries.every(row=>/^\d{15,16}$/.test(row.imei))&&
        new Set(entries.map(row=>row.imei)).size===entries.length,
        422,'IMEI invalide ou répété dans le lot.');
      const result=await transaction(pool,async conn=>{
        const [warehouses]=await conn.query("SELECT id FROM warehouses WHERE id=? AND kind='CENTRAL' AND active=1 FOR UPDATE",[warehouseId]);
        const [products]=await conn.query('SELECT id FROM products WHERE id=? AND active=1 FOR UPDATE',[productId]);
        assert(warehouses.length===1&&products.length===1,404,'Entrepôt ou produit introuvable.');
        const ids=[];
        for(const entry of entries){
          const [insert]=await conn.query(
            "INSERT INTO items(product_id,warehouse_id,imei,location_code,state) VALUES(?,?,?,?,'AVAILABLE')",
            [productId,warehouseId,entry.imei,entry.location]
          );
          ids.push(String(insert.insertId));
        }
        await conn.query(
          'INSERT INTO logs(actor_user_id,action,entity_name,entity_id,details_json) VALUES(?,?,?,?,?)',
          [req.auth.id,'STOCK_RECEIVED','warehouses',warehouseId,JSON.stringify({productId,quantity:ids.length,itemIds:ids})]
        );
        return ids;
      });
      res.status(201).json({quantity:result.length,itemIds:result});
    }catch(error){next(error);}
  });
  return router;
}
