import { applicationSettings } from './configuration.mjs';
﻿import { Router } from 'express';
import { HttpError } from './errors.mjs';

// The DB permission matrix is reloaded on every API request. A revoked grant
// becomes ineffective immediately without trusting any client-side menu.
export function loadAccess(pool){
  return async(req,_res,next)=>{
    try{
      const [rows]=await pool.query(
        "SELECT p.code,p.category FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id "+
        "JOIN roles r ON r.id=rp.role_id WHERE r.code=?",[req.auth.role]
      );
      req.auth.permissions=new Set(rows.map(r=>r.code));
      req.auth.permissionCategories=new Map(rows.map(r=>[r.code,r.category]));
      next();
    }catch(error){next(error);}
  };
}

export function hasPermission(req,permission){
  const code=req.auth?.role;
  const category=req.auth?.permissionCategories?.get(permission);
  if(!category)return false;
  // The technical administrator and business users can never cross the boundary,
  // even if a bad SQL grant was applied directly to role_permissions.
  if(code==='admin')return category==='system';
  if(code!=='admin')return category==='business';
  return false;
}

export function requirePermission(permission){
  return (req,_res,next)=>hasPermission(req,permission)
    ? next()
    : next(new HttpError(403,'Permission requise : '+permission,'PERMISSION_DENIED'));
}

function permissionForRoute(method,path){
  const m=method.toUpperCase(),p=path;
  const isGet=m==='GET',isPost=m==='POST';
  if(p==='/access/me')return null;
  if(/^\/auth\/(me|logout|change-password)$/.test(p))return null;
  if(p==='/events/ticket')return null;
  if(p.startsWith('/system/')){
    if(p==='/system/overview')return 'system.dashboard.view';
    if(/^\/system\/(roles|permissions)(\/|$)/.test(p))return 'system.roles.manage';
    if(/^\/system\/menus(\/|$)/.test(p))return 'system.menus.manage';
    if(/^\/system\/settings(\/|$)/.test(p))return 'system.settings.manage';
    if(p==='/system/audit')return 'system.audit.view';
    return undefined;
  }
  if(p==='/dashboard/summary'||p==='/dashboard/overview')return 'dashboard.view';
  if(p==='/stocks')return 'stocks.view';
  if(p.startsWith('/stocks/'))return 'stocks.manage';
  if(p==='/transfers'||/^\/transfers\/\d+$/.test(p))return isGet?'transfers.view':'transfers.create';
  if(p==='/transfers/pending')return 'transfers.view';
  if(/^\/transfers\/\d+\/(receive|discrepancy)$/.test(p))return 'transfers.receive';
  if(/^\/transfers\/\d+\/resolve$/.test(p))return 'transfers.create';
  if(p==='/sales')return isGet?'sales.view':isPost?'sales.create':undefined;
  if(p==='/sales/stock')return 'sales.create';
  if(/^\/sales\/\d+\/receipt$/.test(p))return 'receipts.view';
  if(/^\/payments\/\d+\/receipt$/.test(p))return 'receipts.view';
  if(p==='/customers')return isGet?'customers.view':isPost?'customers.create':undefined;
  if(/^\/customers\/\d+\/limit$/.test(p))return 'customers.credit.manage';
  if(p==='/debts'||/^\/debts\/\d+\/reminder$/.test(p))return 'debts.view';
  if(/^\/debts\/\d+\/payments$/.test(p))return 'debts.repay';
  if(p==='/cash/today'||p==='/cash/history')return 'cash.view';
  if(p==='/cash/close')return 'cash.close';
  if(p==='/approvals')return isGet?'approvals.view':isPost?'approvals.request':undefined;
  if(p==='/approvals/mine')return 'approvals.request';
  if(/^\/approvals\/\d+\/decision$/.test(p)||/^\/approvals\/sales\/\d+\/cancel$/.test(p))
    return 'approvals.decide';
  if(p==='/inventories'||p==='/inventories/agents'||/^\/inventories\/\d+(\/items)?$/.test(p))
    return 'inventory.view';
  if(p==='/inventories/start'||/^\/inventories\/\d+\/(close|reconcile)$/.test(p)||
    /^\/inventories\/warehouses\/\d+\/freeze$/.test(p))return 'inventory.manage';
  if(p==='/cases')return isGet?'sav.view':'sav.open';
  if(p==='/cases/warehouse')return 'sav.manage';
  if(/^\/cases\/\d+\/(start|resolve|release)$/.test(p))return 'sav.manage';
  if(p==='/reports'||p.startsWith('/reports/'))return 'reports.view';
  if(p==='/users'||/^\/users\/\d+(\/approval-code)?$/.test(p))return 'system.accounts.manage';
  if(p==='/audit/events')return 'audit.view';
  if(p==='/supervision'||/^\/supervision\/\d+\/items$/.test(p))return 'supervision.view';
  if(p==='/settings')return 'pricing.view';
  if(/^\/settings\/products\/\d+$/.test(p))return 'pricing.manage';
  if(p==='/finance/agents'||/^\/finance\/agents\/\d+\/limit$/.test(p))
    return 'customers.credit.manage';
  return undefined;
}
export function enforceAccess(req,_res,next){
  const permission=permissionForRoute(req.method,req.path);
  if(permission===undefined){
    return next(new HttpError(404,'Route inconnue.','NOT_FOUND'));
  }
  if(permission===null||hasPermission(req,permission))return next();
  next(new HttpError(403,'Cette opération n’est pas autorisée pour votre rôle.','PERMISSION_DENIED'));
}

export function accessRoutes(pool){
  const router=Router();
  router.get('/me',async(req,res,next)=>{
    try{
      const [menu]=await pool.query(
        "SELECT m.code,m.name,m.required_permission,rm.sort_order FROM menus m "+
        "JOIN role_menus rm ON rm.menu_id=m.id "+
        "JOIN roles r ON r.id=rm.role_id AND r.code=? "+
        "JOIN permissions p ON p.code=m.required_permission "+
        "JOIN role_permissions rp ON rp.role_id=r.id AND rp.permission_id=p.id "+
        "WHERE m.active=1 AND rm.visible=1 "+
        "ORDER BY rm.sort_order,m.default_sort,m.id",
        [req.auth.role]
      );
      const settings=await applicationSettings(pool);
      res.set('Cache-Control','no-store');
      res.json({
        role:req.auth.role,
        settings:{companyName:settings.companyName,pageSize:settings.pageSize},
        permissions:[...req.auth.permissions].filter(p=>hasPermission(req,p)),
        navigation:menu.filter(m=>hasPermission(req,m.required_permission)).map(m=>({id:m.code,label:m.name,sortOrder:m.sort_order})),
      });
    }catch(error){next(error);}
  });
  return router;
}

