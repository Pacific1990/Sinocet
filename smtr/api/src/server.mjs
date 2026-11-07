import 'dotenv/config';
import { createPoolFromEnv } from './db.mjs';
import { makeApp } from './app.mjs';
import { attachRealtime } from './realtime.mjs';

if(!/^[a-f0-9]{64}$/i.test(process.env.SMTR_TOTP_ENCRYPTION_KEY||'')){
  throw new Error('SMTR_TOTP_ENCRYPTION_KEY must be a private 32-byte hex key.');
}
const pool=createPoolFromEnv();
const app=makeApp(pool);
const port=Number(process.env.SMTR_PORT||4010);
const server=app.listen(port,()=>console.log('SMTR API listening on port '+port));
attachRealtime(server,pool);
for(const signal of ['SIGINT','SIGTERM']){
  process.on(signal,()=>{
    server.close(async()=>{await pool.end();process.exit(0);});
  });
}
