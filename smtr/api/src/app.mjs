import express from 'express';
import helmet from 'helmet';
import { authentication, requireAuth, sessionRoutes } from './auth.mjs';
import { stockRoutes } from './stock.mjs';
import { transferRoutes } from './transfers.mjs';
import { dashboardRoutes } from './dashboard.mjs';
import { HttpError } from './errors.mjs';
import { salesRoutes } from './sales.mjs';
import { creditsRoutes } from './credits.mjs';
import { cashRoutes } from './cash.mjs';
import { approvalsRoutes } from './approvals.mjs';
import { inventoryRoutes } from './inventory.mjs';
import { savRoutes } from './sav.mjs';
import { administrationRoutes } from './admin.mjs';
import { reportRoutes, receiptRoutes } from './reports.mjs';
import { realtimeRoutes, realtimeBus } from './realtime.mjs';
import { loadAccess, enforceAccess, accessRoutes } from './access.mjs';
import { systemRoutes } from './system.mjs';

export function makeApp(pool) {
  const app=express();
  app.disable('x-powered-by');
  app.set('trust proxy',false);
  app.use(helmet({contentSecurityPolicy:false}));
  app.use(express.json({limit:'64kb',strict:true}));
  const allowedOrigin=process.env.SMTR_ALLOWED_ORIGIN || '';
  if(allowedOrigin){
    app.use((req,res,next)=>{
      if(req.get('origin')===allowedOrigin){
        res.set('Access-Control-Allow-Origin',allowedOrigin);
        res.set('Vary','Origin');
        res.set('Access-Control-Allow-Headers','Authorization, Content-Type');
        res.set('Access-Control-Allow-Methods','GET, POST, PATCH, PUT, OPTIONS');
        if(req.method==='OPTIONS')return res.status(204).end();
      }
      next();
    });
  }
  const api=express.Router();
  api.get('/health',async(_req,res,next)=>{
    try{await pool.query('SELECT 1');res.json({status:'ok'});}catch(error){next(error);}
  });
  api.use('/auth',authentication(pool));
  api.use(requireAuth(pool));
  api.use(loadAccess(pool));
  api.use(enforceAccess);
  api.use('/access',accessRoutes(pool));
  api.use('/system',systemRoutes(pool));
  api.use('/auth',sessionRoutes(pool));
  api.use('/dashboard',dashboardRoutes(pool));
  api.use('/stocks',stockRoutes(pool));
  api.use('/transfers',transferRoutes(pool));
  api.use('/sales',salesRoutes(pool));
  api.use('/cash',cashRoutes(pool));
  api.use('/approvals',approvalsRoutes(pool));
  api.use('/inventories',inventoryRoutes(pool));
  api.use('/cases',savRoutes(pool));
  api.use('/reports',reportRoutes(pool));
  api.use('/events',realtimeRoutes(pool));
  api.use('/',creditsRoutes(pool));
  api.use('/',administrationRoutes(pool));
  api.use('/',receiptRoutes(pool));
  api.use((req,_res,next)=>next(new HttpError(404,'Route inconnue.','NOT_FOUND')));
  // Broadcast non-sensitive invalidation only AFTER a successful operation.
  app.use('/smtr/api/v1',(req,res,next)=>{
    if(['POST','PATCH','PUT','DELETE'].includes(req.method)) {
      res.once('finish',()=>{
        if(res.statusCode>=200&&res.statusCode<300&&
           !req.originalUrl.includes('/auth/login')&&
           !req.originalUrl.includes('/events/ticket')){
          realtimeBus.emit('refresh',{resource:req.path.split('/')[4]||'dashboard'});
        }
      });
    }
    next();
  },api);
  app.use((_req,_res,next)=>next(new HttpError(404,'Route inconnue.','NOT_FOUND')));
  app.use((error,_req,res,_next)=>{
    if(['ER_NO_REFERENCED_ROW_2','ER_ROW_IS_REFERENCED_2'].includes(error?.code)) {
      return res.status(409).json({message:'Enregistrement lié manquant ou protégé.',code:'RELATION_CONFLICT'});
    }
    if(['ER_DATA_TOO_LONG','ER_WARN_DATA_OUT_OF_RANGE','ER_CHECK_CONSTRAINT_VIOLATED'].includes(error?.code)) {
      return res.status(422).json({message:'Donnée hors des limites autorisées.',code:'INVALID_VALUE'});
    }
    if(error?.code==='ER_DUP_ENTRY')return res.status(409).json({message:'Enregistrement existant ou IMEI déjà utilisé.',code:'DUPLICATE'});
    if(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)) {
      // Concurrent stock allocation: transaction was rolled back, never claim success.
      return res.status(409).json({message:'Le stock a été modifié simultanément. Actualisez et réessayez.',code:'STOCK_CONFLICT'});
    }
    if(error?.type==='entity.parse.failed'||error?.type==='entity.too.large'){
      return res.status(400).json({message:'Requête JSON invalide.',code:'INVALID_JSON'});
    }
    if(error instanceof HttpError){
      return res.status(error.status).json({message:error.message,code:error.code});
    }
    // Never expose connection information or SQL, secrets or stack traces to clients.
    console.error('SMTR server error:',error?.name || 'Unknown');
    res.status(500).json({message:'Erreur interne. Contactez un administrateur.',code:'INTERNAL'});
  });
  return app;
}
