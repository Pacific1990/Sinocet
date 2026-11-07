import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createPoolFromEnv } from '../src/db.mjs';

const pool=createPoolFromEnv();
const names=['001_core.sql','002_modules.sql','003_safety.sql','004_administrator_rbac.sql','005_agent_approvals_menu.sql','006_transfer_discrepancy_resolution.sql','007_inventory_reconciliation.sql','008_sav_resale_cycles.sql','009_current_sale.sql'];
function statements(sql){
  return sql.split(/\r?\n/).filter(line=>!line.trim().startsWith('--'))
    .join('\n').split(';').map(x=>x.trim()).filter(Boolean);
}
async function migrate(){
  const [[lock]]=await pool.query("SELECT GET_LOCK('smtr_schema_migrate_v2',30) AS got");
  if(lock.got!==1)throw Error('Another SMTR migration is running');
  try{
    await pool.query('CREATE TABLE IF NOT EXISTS schema_steps (key_name VARCHAR(150) PRIMARY KEY, sql_sha CHAR(64) NOT NULL, installed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB');
    for(const name of names){
      const sql=await readFile(fileURLToPath(new URL('../sql/'+name,import.meta.url)),'utf8');
      const parts=statements(sql);
      for(let i=0;i<parts.length;i++){
        const key=name+':'+String(i).padStart(4,'0');
        const hash=createHash('sha256').update(parts[i]).digest('hex');
        const [existing]=await pool.query('SELECT sql_sha FROM schema_steps WHERE key_name=?',[key]);
        if(existing.length){
          if(existing[0].sql_sha!==hash) throw Error('Applied migration changed; do not edit history: '+key);
          continue;
        }
        // DDL MySQL commits independently. Persist a checkpoint for each statement.
        await pool.query(parts[i]);
        await pool.query('INSERT INTO schema_steps(key_name,sql_sha) VALUES(?,?)',[key,hash]);
      }
      console.log('SMTR migration '+name+' verified: '+parts.length+' steps');
    }
  }finally{await pool.query("SELECT RELEASE_LOCK('smtr_schema_migrate_v2')");}
}
try{await migrate();}finally{await pool.end();}
