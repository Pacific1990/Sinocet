import argon2 from 'argon2';
import { Router } from 'express';
import { transaction } from './db.mjs';
import { requireRole } from './auth.mjs';
import { assert, maskImei } from './errors.mjs';
import { amount, audit, choice, idOrFail, textValue } from './utils.mjs';

const roleCodes=['director','manager','agent']; // Technical admin and director use CLI provisioning with 2FA.

export function administrationRoutes(pool){
  const router=Router();

  router.get('/users',requireRole('admin'),async(_req,res,next)=>{
    try{
      const [rows]=await pool.query(
        'SELECT u.id,u.email,u.name,u.active,u.totp_secret_encrypted IS NOT NULL AS has2fa,'+
        'u.approval_pin_hash IS NOT NULL AS hasManagerCode,r.code AS role,w.id AS stockId,w.name AS stockName '+
        'FROM users u JOIN roles r ON r.id=u.role_id '+
        'LEFT JOIN warehouses w ON w.agent_user_id=u.id ORDER BY r.code,u.name LIMIT 500'
      );
      res.json({users:rows.map(u=>({
        id:String(u.id),email:u.email,name:u.name,role:u.role,active:Boolean(u.active),
        has2fa:Boolean(u.has2fa),
        hasManagerCode:Boolean(u.hasManagerCode),
        stockId:u.stockId?String(u.stockId):null,stockName:u.stockName,
      }))});
    }catch(error){next(error);}
  });

  router.post('/users',requireRole('admin'),async(req,res,next)=>{
    try{
      const name=textValue(req.body?.name,2,150);
      const email=textValue(req.body?.email,5,254).toLowerCase();
      assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),422,'Adresse email invalide.');
      const role=choice(req.body?.role,roleCodes);
      const password=textValue(req.body?.temporaryPassword,12,1024);
      const warehouseName=role==='agent'?textValue(req.body?.warehouseName,3,150):null;
      const approvalPin=role==='manager'?String(req.body?.approvalCode||''):null;
      if(role==='manager')assert(/^\d{6}$/.test(approvalPin),422,'Code Manager à six chiffres requis.');
      // 2FA Director enrollment is performed via the private provisioning CLI only.
      assert(role!=='director',403,'Un compte Direction doit être provisionné avec le secret 2FA.');
      const passHash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:65536,timeCost:3});
      const pinHash=approvalPin?await argon2.hash(approvalPin,{type:argon2.argon2id}):null;
      const outcome=await transaction(pool,async conn=>{
        const [roles]=await conn.query('SELECT id FROM roles WHERE code=?',[role]);
        assert(roles.length,422,'Rôle inconnu.');
        const [created]=await conn.query(
          'INSERT INTO users(email,name,password_hash,role_id,approval_pin_hash) VALUES(?,?,?,?,?)',
          [email,name,passHash,roles[0].id,pinHash]
        );
        let warehouseId=null;
        if(role==='agent'){
          const [warehouse]=await conn.query(
            "INSERT INTO warehouses(name,kind,agent_user_id) VALUES(?,'AGENT',?)",
            [warehouseName,created.insertId]
          );
          warehouseId=String(warehouse.insertId);
        }
        await audit(conn,req,'USER_CREATED','users',created.insertId,{name,email,role,warehouseId});
        return {id:String(created.insertId),role,name,email,warehouseId};
      });
      res.status(201).json({user:outcome});
    }catch(error){next(error);}
  });

  router.patch('/users/:id',requireRole('admin'),async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Utilisateur');
      const props=req.body||{};
      const hasActive=typeof props.active==='boolean';
      assert(props.creditLimitF===undefined,403,'Les plafonds financiers sont réservés à la Direction.');
      const hasRole=props.role!==undefined;
      assert(hasActive||hasRole,422,'Aucun changement demandé.');
      const role=hasRole?choice(props.role,roleCodes):null;
      const result=await transaction(pool,async conn=>{
        const [rows]=await conn.query(
          'SELECT u.id,u.active,r.code AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? FOR UPDATE',[id]
        );
        const user=rows[0];
        assert(user,404,'Utilisateur introuvable.');
        assert(user.role!=='admin',403,
          'Les comptes Administrateur sont protégés et gérés exclusivement par le provisionnement sécurisé.');
        const newActive=hasActive?Boolean(props.active):Boolean(user.active);
        if(!newActive||role&&role!=='director'){
          assert(req.auth.id!==id,403,'Impossible de désactiver ou rétrograder son propre compte Administrateur.');
        }
        if(hasRole&&role!==user.role){
          assert(user.role!=='director',403,
            'Le changement de rôle Direction nécessite une procédure sécurisée hors interface.');
          assert(role!=='director',403,'Compte Direction exclusivement via provisioning 2FA.');
          const [holding]=await conn.query(
            "SELECT COUNT(*) AS total FROM warehouses w JOIN items i ON i.warehouse_id=w.id "+
            "WHERE w.agent_user_id=? AND i.state IN ('AVAILABLE','IN_TRANSIT','HOLD')",[id]
          );
          assert(!Number(holding[0].total),409,'Transférez les stocks avant de modifier ce rôle.');
          const [roleRow]=await conn.query('SELECT id FROM roles WHERE code=?',[role]);
          await conn.query('UPDATE users SET role_id=? WHERE id=?',[roleRow[0].id,id]);
        }
        if(hasActive)await conn.query('UPDATE users SET active=? WHERE id=?',[newActive?1:0,id]);
        if((hasActive&&!newActive)||hasRole)await conn.query('DELETE FROM sessions WHERE user_id=?',[id]);
        const after={active:newActive,role:role||user.role,};
        await audit(conn,req,'USER_UPDATED','users',id,{
          before:{active:Boolean(user.active),role:user.role},
          after,
        });
        return {id,...after};
      });
      res.json({user:result});
    }catch(error){next(error);}
  });

  router.post('/users/:id/approval-code',requireRole('admin'),async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Utilisateur');
      const code=String(req.body?.approvalCode||'');
      assert(/^\d{6}$/.test(code),422,'Code manager à 6 chiffres obligatoire.');
      const hashed=await argon2.hash(code,{type:argon2.argon2id});
      const result=await transaction(pool,async conn=>{
        const [users]=await conn.query(
          "SELECT u.id,r.code AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? FOR UPDATE",[id]
        );
        assert(users.length&&users[0].role==='manager',403,'Seul un Manager peut avoir un code de validation.');
        await conn.query('UPDATE users SET approval_pin_hash=? WHERE id=?',[hashed,id]);
        await audit(conn,req,'MANAGER_APPROVAL_CODE_CHANGED','users',id,{configured:true});
        return {id,hasManagerCode:true};
      });
      res.json({user:result});
    }catch(error){next(error);}
  });

  router.get('/finance/agents',requireRole('director'),async(_req,res,next)=>{
    try{
      const [rows]=await pool.query(
        "SELECT u.id,u.name,u.credit_limit_f,COALESCE(SUM(CASE WHEN d.status='OPEN' THEN d.remaining_amount_f ELSE 0 END),0) AS outstanding "+
        "FROM users u JOIN roles r ON r.id=u.role_id AND r.code='agent' "+
        "LEFT JOIN debts d ON d.agent_user_id=u.id GROUP BY u.id,u.name,u.credit_limit_f ORDER BY u.name"
      );
      res.json({agents:rows.map(row=>({
        id:String(row.id),name:row.name,creditLimitF:Number(row.credit_limit_f),
        outstandingF:Number(row.outstanding),
      }))});
    }catch(error){next(error);}
  });
  router.patch('/finance/agents/:id/limit',requireRole('director'),async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Agent');
      const limit=amount(req.body?.creditLimitF);
      const result=await transaction(pool,async conn=>{
        const [agents]=await conn.query(
          "SELECT u.id,u.credit_limit_f FROM users u JOIN roles r ON r.id=u.role_id AND r.code='agent' WHERE u.id=? FOR UPDATE",
          [id]
        );
        assert(agents.length,404,'Agent introuvable.');
        const [owed]=await conn.query(
          "SELECT COALESCE(SUM(remaining_amount_f),0) AS total FROM debts WHERE agent_user_id=? AND status='OPEN'",
          [id]
        );
        assert(limit>=Number(owed[0].total),409,'Plafond inférieur aux créances actives.');
        await conn.query('UPDATE users SET credit_limit_f=? WHERE id=?',[limit,id]);
        await audit(conn,req,'AGENT_CREDIT_LIMIT_CHANGED','users',id,{
          before:Number(agents[0].credit_limit_f),after:limit,
        });
        return {id,creditLimitF:limit};
      });
      res.json({agent:result});
    }catch(error){next(error);}
  });

  router.get('/audit/events',requireRole('director','manager'),async(req,res,next)=>{
    try{
      const director=req.auth.role==='director';
      const [rows]=await pool.query(
        'SELECT l.id,l.actor_user_id,l.action,l.entity_name,l.entity_id,l.details_json,l.source_ip,'+
        'l.occurred_at AS occurredAt,u.name AS actor FROM logs l '+
        'JOIN users u ON u.id=l.actor_user_id '+
        (director?'':'WHERE l.actor_user_id=? ')+
        'ORDER BY l.occurred_at DESC,l.id DESC LIMIT 500',
        director?[]:[req.auth.id]
      );
      res.json({events:rows.map(l=>({
        id:String(l.id),actor:l.actor,action:l.action,entity:l.entity_name,
        entityId:l.entity_id?String(l.entity_id):null,occurredAt:l.occurredAt,
        sourceIp:director?l.source_ip:null,details:director?l.details_json:null,
      }))});
    }catch(error){next(error);}
  });

  router.get('/supervision',requireRole('manager','director'),async(req,res,next)=>{
    try {
      const [warehouses]=await pool.query(
        'SELECT w.id,w.name,w.kind,w.frozen,w.location,u.name AS agentName,'+
        "SUM(CASE WHEN i.state='AVAILABLE' THEN 1 ELSE 0 END) AS available,"+
        "SUM(CASE WHEN i.state='IN_TRANSIT' THEN 1 ELSE 0 END) AS transit,"+
        "SUM(CASE WHEN i.state='HOLD' THEN 1 ELSE 0 END) AS hold,"+
        "SUM(CASE WHEN i.state='SAV' THEN 1 ELSE 0 END) AS sav "+
        'FROM warehouses w LEFT JOIN users u ON u.id=w.agent_user_id '+
        'LEFT JOIN items i ON i.warehouse_id=w.id WHERE w.active=1 GROUP BY w.id,w.name,w.kind,w.frozen,w.location,u.name ORDER BY w.kind,w.id'
      );
      const [transfers]=await pool.query(
        "SELECT tr.id,tr.status,tr.sent_at,DATEDIFF(UTC_TIMESTAMP(),tr.sent_at) AS daysPending "+
        "FROM transfers tr WHERE tr.status IN ('IN_TRANSIT','DISCREPANCY') ORDER BY tr.sent_at LIMIT 100"
      );
      res.json({
        warehouses:warehouses.map(w=>({
          id:String(w.id),name:w.name,kind:w.kind,frozen:Boolean(w.frozen),
          agent:w.agentName||null,location:w.location,available:Number(w.available),
          transit:Number(w.transit),hold:Number(w.hold),sav:Number(w.sav),
        })),
        transfers:transfers.map(t=>({
          id:String(t.id),status:t.status,sentAt:t.sent_at,daysPending:Number(t.daysPending),
        })),
      });
    }catch(error){next(error);}
  });

  router.get('/supervision/:id/items',requireRole('manager','director'),async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Entrepôt');
      const [items]=await pool.query(
        'SELECT i.id,i.imei,i.state,i.location_code,i.received_at,p.name AS product '+
        'FROM items i JOIN products p ON p.id=i.product_id WHERE i.warehouse_id=? '+
        'ORDER BY i.updated_at DESC LIMIT 300',[id]
      );
      res.json({items:items.map(i=>({
        id:String(i.id),imeiMasked:maskImei(i.imei),product:i.product,
        status:i.state,location:i.location_code,receivedAt:i.received_at,
      }))});
    }catch(error){next(error);}
  });

  router.get('/settings',requireRole('director','manager'),async(_req,res,next)=>{
    try{
      const [rows]=await pool.query('SELECT id,name,category,sku,minimum_level,sale_price_f FROM products ORDER BY name');
      res.json({products:rows.map(r=>({
        id:String(r.id),name:r.name,category:r.category,sku:r.sku,
        minimumLevel:r.minimum_level,salePriceF:r.sale_price_f===null?null:Number(r.sale_price_f),
      }))});
    }catch(error){next(error);}
  });

  router.patch('/settings/products/:id',requireRole('director'),async(req,res,next)=>{
    try{
      const id=idOrFail(req.params.id,'Produit');
      const input=req.body||{};
      const min=input.minimumLevel===undefined?null:amount(input.minimumLevel,{max:100000});
      const sale=input.salePriceF===undefined?null:amount(input.salePriceF,{min:1});
      const cost=input.purchaseCostF===undefined?null:amount(input.purchaseCostF);
      assert(min!==null||sale!==null||cost!==null,422,'Aucun paramètre reçu.');
      const r=await transaction(pool,async conn=>{
        const [products]=await conn.query('SELECT id,minimum_level,sale_price_f,purchase_cost_f FROM products WHERE id=? FOR UPDATE',[id]);
        assert(products.length,404,'Produit introuvable.');
        const prior=products[0];
        await conn.query(
          'UPDATE products SET minimum_level=?,sale_price_f=?,purchase_cost_f=? WHERE id=?',
          [min??prior.minimum_level,sale??prior.sale_price_f,cost??prior.purchase_cost_f,id]
        );
        await audit(conn,req,'PRODUCT_PRICING_UPDATED','products',id,{
          before:{min:prior.minimum_level,sale:prior.sale_price_f,cost:prior.purchase_cost_f},
          after:{min:min??prior.minimum_level,sale:sale??prior.sale_price_f,cost:cost??prior.purchase_cost_f},
        });
        return {id};
      });
      res.json({product:r});
    }catch(error){next(error);}
  });

  return router;
}
