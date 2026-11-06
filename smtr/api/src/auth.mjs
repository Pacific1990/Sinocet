import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { transaction } from './db.mjs';
import { HttpError, assert } from './errors.mjs';
import { decryptTotp, matchTotp } from './totp.mjs';

const sessionLifetimeHours = 8;
const dummyHash = argon2.hash('not-an-account', { type: argon2.argon2id });
export const digestToken = token => createHash('sha256').update(token).digest('hex');
const publicUser = user => ({
  id: String(user.id), name: user.name, role: user.role,
  twoFactorVerified: user.two_factor_verified === true,
});
const tooMany = new HttpError(429, 'Trop de tentatives. Réessayez plus tard.', 'ACCOUNT_LOCKED');
const generic = () => new HttpError(401, 'Identifiants ou code de vérification invalides.', 'INVALID_CREDENTIALS');

export function authentication(pool) {
  const router = Router();
  router.post('/login',rateLimit({
    windowMs: 15*60*1000, limit: 20, standardHeaders: 'draft-7',
    legacyHeaders: false, keyGenerator: undefined,
    message: {message:'Trop de tentatives. Réessayez plus tard.',code:'RATE_LIMITED'},
  }),async(req,res,next)=>{
    const { email, password, otp } = req.body || {};
    if(typeof email!=='string'||typeof password!=='string'||
       email.length>254||password.length>1024||!email.trim()||!password) {
      return next(generic());
    }
    try {
      const outcome=await transaction(pool,async conn=>{
        const [users]=await conn.query(
          'SELECT u.id,u.email,u.name,u.password_hash,u.active,u.failed_attempts,u.locked_until,'+
          'u.totp_secret_encrypted,u.last_totp_counter,r.code AS role '+
          'FROM users u INNER JOIN roles r ON r.id=u.role_id WHERE u.email=? LIMIT 1 FOR UPDATE',
          [email.trim().toLowerCase()]
        );
        const user=users[0];
        if (!user) {
          await argon2.verify(await dummyHash,password);
          throw generic();
        }
        if (!user.active || user.locked_until && new Date(user.locked_until).getTime()>Date.now()) {
          throw tooMany;
        }
        let validPassword=false;
        try { validPassword=await argon2.verify(user.password_hash,password); } catch { /* reject */ }
        let counter=null;
        let validTotp=true;
        if(validPassword && (user.role==='director'||user.totp_secret_encrypted)) {
          if(!user.totp_secret_encrypted) {
            throw new HttpError(403,'La Direction doit activer la double authentification.','TOTP_NOT_CONFIGURED');
          }
          validTotp=false;
          if(typeof otp==='string') {
            counter=matchTotp(decryptTotp(user.totp_secret_encrypted),otp,user.last_totp_counter);
            validTotp=counter!==null;
          }
        }
        if(!validPassword || !validTotp) {
          const attempts=Number(user.failed_attempts)+1;
          await conn.query(
            'UPDATE users SET failed_attempts=?,locked_until=IF(? >= 5,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),NULL) WHERE id=?',
            [attempts,attempts,user.id]
          );
          // Do not throw here: MySQL rollback must not undo lockout accounting.
          return {denied:true};
        }
        const token=randomBytes(32).toString('base64url');
        if(counter!==null) {
          const [updated]=await conn.query(
            'UPDATE users SET last_totp_counter=? WHERE id=? AND (last_totp_counter IS NULL OR last_totp_counter < ?)',
            [counter,user.id,counter]
          );
          assert(updated.affectedRows===1,401,'Code déjà utilisé.','TOTP_REPLAY');
        }
        await conn.query('UPDATE users SET failed_attempts=0,locked_until=NULL WHERE id=?',[user.id]);
        await conn.query(
          'INSERT INTO sessions(user_id,token_hash,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? HOUR))',
          [user.id,digestToken(token),sessionLifetimeHours]
        );
        return {accessToken:token,user:publicUser({...user,two_factor_verified:counter!==null})};
      });
      if (outcome.denied) return next(generic());
      res.json(outcome);
    } catch(error){next(error);}
  });
  return router;
}

export function requireAuth(pool) {
  return async(req,res,next)=>{
    const header=req.get('authorization')||'';
    const match=/^Bearer ([A-Za-z0-9_-]{35,256})$/.exec(header);
    if(!match) return next(new HttpError(401,'Authentification requise.','UNAUTHENTICATED'));
    try {
      const [rows]=await pool.query(
        'SELECT u.id,u.name,u.active,r.code AS role,s.token_hash '+
        'FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id '+
        'WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() LIMIT 1',
        [digestToken(match[1])]
      );
      const user=rows[0];
      if(!user?.active) return next(new HttpError(401,'Session expirée ou révoquée.','UNAUTHENTICATED'));
      req.auth={id:String(user.id),name:user.name,role:user.role,tokenHash:user.token_hash};
      next();
    }catch(error){next(error);}
  };
}
export function requireRole(...roles) {
  return (req,_res,next) => roles.includes(req.auth?.role)
    ? next() : next(new HttpError(403,'Action interdite pour ce rôle.','FORBIDDEN'));
}
export function sessionRoutes(pool) {
  const router=Router();
  router.get('/me',(req,res)=>res.json({user:publicUser({...req.auth,two_factor_verified:req.auth.role==='director'})}));
  router.post('/logout',async(req,res,next)=>{
    try{await pool.query('DELETE FROM sessions WHERE token_hash=?',[req.auth.tokenHash]);res.status(204).end();}
    catch(error){next(error);}
  });
  return router;
}
