import 'dotenv/config';
import argon2 from 'argon2';
import { createPoolFromEnv, transaction } from '../src/db.mjs';
import { encryptTotp, newTotpSecret } from '../src/totp.mjs';

const pool=createPoolFromEnv();
const action=process.env.SMTR_PROVISION_ACTION || 'user';
try {
  if(action==='user'){
    const name=(process.env.SMTR_USER_NAME||'').trim();
    const email=(process.env.SMTR_USER_EMAIL||'').trim().toLowerCase();
    const role=process.env.SMTR_USER_ROLE;
    const password=process.env.SMTR_USER_PASSWORD||'';
    if(name.length<2||name.length>150||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
       !['director','manager','agent'].includes(role)||password.length<12) {
      throw new Error('Missing/invalid user name, email, role or a password of at least 12 characters');
    }
    const agentWarehouseName=(process.env.SMTR_AGENT_WAREHOUSE_NAME||'').trim();
    if(role==='agent' && !agentWarehouseName) throw new Error('SMTR_AGENT_WAREHOUSE_NAME required for agent');
    const generatedSecret=role==='director'?newTotpSecret():null;
    const totpCipher=generatedSecret?encryptTotp(generatedSecret):null;
    const passwordHash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});
    const id=await transaction(pool,async conn=>{
      const [roles]=await conn.query('SELECT id FROM roles WHERE code=?',[role]);
      if(!roles.length)throw new Error('Role tables missing: migrate first');
      const [user]=await conn.query(
        'INSERT INTO users(email,name,password_hash,role_id,totp_secret_encrypted) VALUES (?,?,?,?,?)',
        [email,name,passwordHash,roles[0].id,totpCipher]
      );
      if(role==='agent'){
        await conn.query("INSERT INTO warehouses(name,kind,agent_user_id) VALUES (?,'AGENT',?)",
          [agentWarehouseName,user.insertId]);
      }
      return user.insertId;
    });
    console.log('SMTR user created:',id,role,email);
    if(generatedSecret) {
      // Secret is shown ONCE only in this authorized terminal; never checked into git.
      const uri='otpauth://totp/'+encodeURIComponent('SMTR:'+email)+'?secret='+generatedSecret+'&issuer=SMTR';
      console.log('Director 2FA enrollment URI (keep strictly private):',uri);
      console.log('Store this in an authenticator app before first login; never send it to an untrusted service.');
    }
  } else if(action==='warehouse'){
    const kind=process.env.SMTR_WAREHOUSE_KIND || 'CENTRAL';
    const name=(process.env.SMTR_WAREHOUSE_NAME||'').trim();
    if(!['CENTRAL','SAV'].includes(kind)||name.length<3||name.length>150) {
      throw new Error('Warehouse name (3-150 chars) and kind CENTRAL/SAV required');
    }
    const [r]=await pool.query('INSERT INTO warehouses(name,kind,location) VALUES(?,?,?)',
      [name,kind,process.env.SMTR_WAREHOUSE_LOCATION||null]);
    console.log('SMTR warehouse created:',r.insertId,kind);
  } else throw new Error('Unsupported provision action');
}finally{await pool.end();}
