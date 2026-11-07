import { Router } from 'express';
import { transaction } from './db.mjs';
import { requireRole } from './auth.mjs';
import { assert } from './errors.mjs';
import { audit, choice, textValue } from './utils.mjs';

const BUSINESS_CAP={
  director:new Set([
    'dashboard.view','stocks.view','stocks.manage','transfers.view','transfers.create',
    'sales.view','customers.view','customers.create','customers.credit.manage',
    'debts.view','cash.view','approvals.view','approvals.decide','inventory.view',
    'inventory.manage','sav.view','sav.manage','reports.view','supervision.view',
    'pricing.view','pricing.manage','audit.view','receipts.view'
  ]),
  manager:new Set([
    'dashboard.view','stocks.view','stocks.manage','transfers.view','transfers.create',
    'sales.view','customers.view','customers.create','customers.credit.manage',
    'debts.view','cash.view','approvals.view','approvals.decide',
    'inventory.view','inventory.manage','sav.view','sav.manage','reports.view',
    'supervision.view','pricing.view','audit.view','receipts.view'
  ]),
  agent:new Set([
    'dashboard.view','stocks.view','transfers.view','transfers.receive',
    'sales.view','sales.create','customers.view','customers.create',
    'debts.view','debts.repay','cash.view','cash.close',
    'approvals.view','approvals.request','sav.view','sav.open','receipts.view'
  ]),
};
// Prevent granting a business permission that contradicts the account's fixed
// operational role and the controller's ownership/approval rules.
const ROLES=['director','manager','agent'];
const SETTINGS={
  'company.name':{type:'string',min:3,max:120},
  'alerts.transit_days':{type:'number',min:1,max:90},
  'alerts.sav_days':{type:'number',min:1,max:180},
  'ui.page_size':{type:'number',min:10,max:100},
};
function validateSetting(key,value){
  const schema=SETTINGS[key];
  assert(schema,422,'Paramètre non modifiable.');
  if(schema.type==='string'){
    assert(typeof value==='string'&&value.trim().length>=schema.min&&
      value.trim().length<=schema.max,422,'Valeur textuelle invalide.');
    return value.trim();
  }
  assert(Number.isSafeInteger(value)&&value>=schema.min&&value<=schema.max,
    422,'Valeur numérique invalide.');
  return value;
}

export function systemRoutes(pool){
  const router=Router();
  router.use(requireRole('admin'));

  router.get('/overview',async(_req,res,next)=>{
    try{
      const counts=await Promise.all([
        pool.query('SELECT COUNT(*) AS total FROM users'),
        pool.query('SELECT COUNT(*) AS total FROM roles'),
        pool.query('SELECT COUNT(*) AS total FROM permissions'),
        pool.query('SELECT COUNT(*) AS total FROM menus WHERE active=1')
      ]);
      const [users,roles,permissions,menus]=counts.map(([rows])=>Number(rows[0].total));
      res.json({metrics:[
        {id:'users',label:'UTILISATEURS',value:users},
        {id:'roles',label:'RÔLES',value:roles},
        {id:'permissions',label:'PERMISSIONS',value:permissions},
        {id:'menus',label:'MENUS ACTIFS',value:menus},
      ]});
    }catch(error){next(error);}
  });

  router.get('/roles',async(_req,res,next)=>{
    try{
      const [rows]=await pool.query(
        'SELECT r.id,r.code,r.name,r.description,COUNT(DISTINCT rp.permission_id) AS grants '+
        'FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id '+
        'GROUP BY r.id,r.code,r.name,r.description ORDER BY FIELD(r.code,\'admin\',\'director\',\'manager\',\'agent\')'
      );
      res.json({roles:rows.map(r=>({
        id:String(r.id),code:r.code,name:r.name,description:r.description,
        permissionsCount:Number(r.grants),editable:r.code!=='admin',
      }))});
    }catch(error){next(error);}
  });

  router.get('/permissions',async(_req,res,next)=>{
    try{
      const [catalog]=await pool.query(
        'SELECT id,code,name,description,category FROM permissions ORDER BY category,code'
      );
      const [grants]=await pool.query(
        'SELECT r.code AS role,p.code AS permission FROM role_permissions rp '+
        'JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id'
      );
      const granted={};
      for(const row of grants)(granted[row.role]??=[]).push(row.permission);
      res.json({
        permissions:catalog.map(p=>({
          id:String(p.id),code:p.code,name:p.name,description:p.description,category:p.category,
          editableFor:ROLES.filter(role=>BUSINESS_CAP[role].has(p.code)),
        })),
        grants:granted,
      });
    }catch(error){next(error);}
  });

  router.put('/roles/:code/permissions',async(req,res,next)=>{
    try{
      const role=choice(req.params.code,ROLES);
      const codes=req.body?.permissions;
      assert(Array.isArray(codes)&&codes.length>0&&codes.length<=60&&
        codes.every(p=>typeof p==='string'&&BUSINESS_CAP[role].has(p))&&
        new Set(codes).size===codes.length,422,
        'Les permissions doivent appartenir au périmètre autorisé de ce rôle.');
      assert(codes.includes('dashboard.view'),422,'Le tableau de bord ne peut pas être retiré.');
      const output=await transaction(pool,async conn=>{
        const [roles]=await conn.query('SELECT id FROM roles WHERE code=? FOR UPDATE',[role]);
        assert(roles.length,404,'Rôle inconnu.');
        const roleId=String(roles[0].id);
        const [before]=await conn.query(
          'SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=?',
          [roleId]
        );
        const [permissions]=await conn.query(
          'SELECT id,code FROM permissions WHERE code IN ('+codes.map(()=>'?').join(',')+') AND category=\'business\'',
          codes
        );
        assert(permissions.length===codes.length,422,'Permission inconnue.');
        await conn.query('DELETE FROM role_permissions WHERE role_id=?',[roleId]);
        for(const permission of permissions)await conn.query(
          'INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)',[roleId,permission.id]
        );
        // Newly granted modules appear in the role menu matrix, but remain hidden
        // until an administrator explicitly enables them.
        await conn.query(
          'INSERT IGNORE INTO role_menus(role_id,menu_id,visible,sort_order) '+
          'SELECT ?,m.id,0,m.default_sort FROM menus m '+
          'JOIN permissions p ON p.code=m.required_permission '+
          'JOIN role_permissions rp ON rp.permission_id=p.id AND rp.role_id=?',
          [roleId,roleId]
        );
        // Permission changes revoke active sessions of affected users immediately.
        await conn.query(
          'DELETE s FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.role_id=?',[roleId]
        );
        const removed=before.map(x=>x.code).filter(p=>!codes.includes(p));
        await audit(conn,req,'ROLE_PERMISSIONS_UPDATED','roles',roleId,{
          role,previous:before.map(x=>x.code),new:codes,removed,
        });
        return {role,permissions:codes,revokedSessions:true};
      });
      res.json({role:output});
    }catch(error){next(error);}
  });

  router.get('/menus',async(_req,res,next)=>{
    try{
      const [rows]=await pool.query(
        'SELECT m.id,m.code,m.name,m.required_permission,m.active,m.default_sort,'+
        'r.code AS role,rm.visible,rm.sort_order '+
        'FROM menus m LEFT JOIN role_menus rm ON rm.menu_id=m.id '+
        'LEFT JOIN roles r ON r.id=rm.role_id ORDER BY m.default_sort,m.id,rm.sort_order'
      );
      const menus=new Map();
      for(const row of rows){
        if(!menus.has(row.id))menus.set(row.id,{
          id:String(row.id),code:row.code,name:row.name,
          permission:row.required_permission,active:Boolean(row.active),
          defaultSort:Number(row.default_sort),roles:[],
        });
        if(row.role)menus.get(row.id).roles.push({
          role:row.role,visible:Boolean(row.visible),sortOrder:Number(row.sort_order),
        });
      }
      res.json({menus:[...menus.values()]});
    }catch(error){next(error);}
  });

  router.put('/roles/:code/menus',async(req,res,next)=>{
    try{
      const role=choice(req.params.code,ROLES);
      const codes=req.body?.menus;
      assert(Array.isArray(codes)&&codes.length>0&&codes.length<=30&&
        codes.every(x=>typeof x==='string'&&/^[a-z_]{2,40}$/.test(x))&&
        new Set(codes).size===codes.length,422,'Menus invalides.');
      assert(codes.includes('dashboard'),422,'Le menu Accueil est obligatoire.');
      const result=await transaction(pool,async conn=>{
        const [roles]=await conn.query('SELECT id FROM roles WHERE code=? FOR UPDATE',[role]);
        assert(roles.length,404,'Rôle inconnu.');
        const roleId=String(roles[0].id);
        const [allowed]=await conn.query(
          'SELECT m.id,m.code FROM menus m '+
          'JOIN permissions p ON p.code=m.required_permission '+
          'JOIN role_permissions rp ON rp.permission_id=p.id AND rp.role_id=? '+
          'WHERE m.active=1 AND p.category=\'business\'',[roleId]
        );
        const byCode=new Map(allowed.map(row=>[row.code,row.id]));
        assert(codes.every(code=>byCode.has(code)),403,
          'Un menu demandé nécessite une permission non accordée.');
        await conn.query('UPDATE role_menus SET visible=0 WHERE role_id=?',[roleId]);
        for(let index=0;index<codes.length;index++){
          await conn.query(
            'INSERT INTO role_menus(role_id,menu_id,visible,sort_order) VALUES(?,?,1,?) '+
            'ON DUPLICATE KEY UPDATE visible=1,sort_order=VALUES(sort_order)',
            [roleId,byCode.get(codes[index]),(index+1)*10]
          );
        }
        await audit(conn,req,'ROLE_MENUS_UPDATED','roles',roleId,{
          role,menus:codes,
        });
        return {role,menus:codes};
      });
      res.json({role:result});
    }catch(error){next(error);}
  });

  router.get('/settings',async(_req,res,next)=>{
    try{
      const [rows]=await pool.query(
        'SELECT key_name,CAST(value_json AS CHAR) AS value_json,updated_at FROM system_settings ORDER BY key_name'
      );
      res.json({settings:rows.filter(row=>SETTINGS[row.key_name]).map(row=>({
        key:row.key_name,value:typeof row.value_json==='string'
          ?JSON.parse(row.value_json):row.value_json,updatedAt:row.updated_at,
      }))});
    }catch(error){next(error);}
  });

  router.put('/settings/:key',async(req,res,next)=>{
    try{
      const key=req.params.key;
      const value=validateSetting(key,req.body?.value);
      const result=await transaction(pool,async conn=>{
        const [before]=await conn.query(
          'SELECT CAST(value_json AS CHAR) AS value_json FROM system_settings WHERE key_name=? FOR UPDATE',[key]
        );
        assert(before.length,404,'Paramètre introuvable.');
        const old=typeof before[0].value_json==='string'
          ?JSON.parse(before[0].value_json):before[0].value_json;
        await conn.query(
          'UPDATE system_settings SET value_json=?,updated_by_user_id=? WHERE key_name=?',
          [JSON.stringify(value),req.auth.id,key]
        );
        await audit(conn,req,'SYSTEM_SETTING_CHANGED','system_settings',null,{
          key,before:old,after:value,
        });
        return {key,value};
      });
      res.json({setting:result});
    }catch(error){next(error);}
  });

  router.get('/audit',async(_req,res,next)=>{
    try{
      const [rows]=await pool.query(
        "SELECT l.id,l.action,l.occurred_at,u.name AS actor,l.entity_name "+
        "FROM logs l JOIN users u ON u.id=l.actor_user_id "+
        "WHERE l.action IN ('ROLE_PERMISSIONS_UPDATED','ROLE_MENUS_UPDATED','SYSTEM_SETTING_CHANGED',"+
        "'USER_CREATED','USER_UPDATED','PASSWORD_CHANGED','MANAGER_APPROVAL_CODE_CHANGED') "+
        "ORDER BY l.occurred_at DESC,l.id DESC LIMIT 200"
      );
      res.json({events:rows.map(row=>({
        id:String(row.id),action:row.action,actor:row.actor,
        entity:row.entity_name,occurredAt:row.occurred_at,
      }))});
    }catch(error){next(error);}
  });
  return router;
}
