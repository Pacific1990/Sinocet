import express from 'express';
import helmet from 'helmet';
import { authentication, requireAuth, sessionRoutes } from './auth.mjs';
import { stockRoutes } from './stock.mjs';
import { transferRoutes } from './transfers.mjs';
import { dashboardRoutes } from './dashboard.mjs';
import { HttpError } from './errors.mjs';

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
        res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');
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
  api.use('/auth',sessionRoutes(pool));
  api.use('/dashboard',dashboardRoutes(pool));
  api.use('/stocks',stockRoutes(pool));
  api.use('/transfers',transferRoutes(pool));
  api.use((req,_res,next)=>next(new HttpError(404,'Route inconnue.','NOT_FOUND')));
  app.use('/smtr/api/v1',api);
  app.use((_req,_res,next)=>next(new HttpError(404,'Route inconnue.','NOT_FOUND')));
  app.use((error,_req,res,_next)=>{
    if(error?.code==='ER_DUP_ENTRY')return res.status(409).json({message:'Enregistrement existant ou IMEI déjà utilisé.',code:'DUPLICATE'});
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
