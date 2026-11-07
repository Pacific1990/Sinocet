import { createHash } from 'node:crypto';
import { HttpError, assert, positiveId } from './errors.mjs';

export const idOrFail=(value,name='Identifiant')=>{
  const id=positiveId(value);
  assert(id,422,name+' invalide.');
  return id;
};
export const amount=(value,{min=0,max=1000000000000}={})=>{
  assert(typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max,422,'Montant en FCFA invalide.');
  return value;
};
export const choice=(value,allowed)=>{assert(allowed.includes(value),422,'Valeur non autorisée.');return value;};
export const textValue=(v,min=1,max=500)=>{
  assert(typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max,422,'Texte requis ou trop long.');
  return v.trim();
};
export const uuid=value=>{
  assert(typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),422,'Référence de requête invalide.');
  return value;
};
export const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const businessDay=()=>new Date().toISOString().slice(0,10);
export const dateValue=value=>{
  assert(typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&!Number.isNaN(new Date(value+'T00:00:00Z').getTime())&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value,422,'Date invalide.');
  return value;
};
export const roleCheck=(req,...roles)=>{
  assert(roles.includes(req.auth.role),403,'Vous ne disposez pas des permissions nécessaires.');
};
export const lockedUser=async(conn,req)=>{
  const [rows]=await conn.query("SELECT u.id,u.active,u.credit_limit_f,r.code AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? FOR UPDATE",[req.auth.id]);
  assert(rows.length===1&&rows[0].active===1,401,'Compte inactif.');
  return rows[0];
};
export async function audit(conn,req,action,entity,id,details={}){
  await conn.query('INSERT INTO logs(actor_user_id,action,entity_name,entity_id,details_json,source_ip) VALUES(?,?,?,?,?,?)',
    [req.auth.id,action,entity,id,JSON.stringify(details),req.ip||null]);
}
export function failOnDuplicate(error){
  if(error?.code==='ER_DUP_ENTRY')throw new HttpError(409,'Enregistrement déjà existant.');
  throw error;
}
