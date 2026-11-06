import 'dotenv/config';
import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';
import request from 'supertest';
import {createPoolFromEnv} from '../src/db.mjs';
import {makeApp} from '../src/app.mjs';
import {encryptTotp,newTotpSecret,totpCode} from '../src/totp.mjs';

const base='/smtr/api/v1';
const PASSWORD='SuperSecurePassword-2026!';
let pool,app,users,warehouses,items,secret;

before(async()=>{
  process.env.SMTR_TOTP_ENCRYPTION_KEY ||= '0'.repeat(64);
  pool=createPoolFromEnv();
  app=makeApp(pool);
  await pool.query('SELECT id FROM roles LIMIT 1');
});
after(async()=>{if(pool)await pool.end();});
beforeEach(async()=>{
  for(const table of ['logs','transfers_items','transfers','items','products','warehouses','sessions','users']){
    await pool.query('DELETE FROM '+table);
  }
  secret=newTotpSecret();
  const [roles]=await pool.query('SELECT id,code FROM roles');
  const map=Object.fromEntries(roles.map(r=>[r.code,r.id]));
  const hash=await argon2.hash(PASSWORD,{type:argon2.argon2id,memoryCost:4096,timeCost:2});
  users={};
  for(const [role,email] of [['director','director@smtr.test'],['manager','manager@smtr.test'],
                               ['agent','agent@smtr.test'],['agent2','other@smtr.test']]){
    const normalizedRole=role==='agent2'?'agent':role;
    const [result]=await pool.query(
      'INSERT INTO users(email,name,password_hash,role_id,totp_secret_encrypted) VALUES(?,?,?,?,?)',
      [email,role,hash,map[normalizedRole],role==='director'?encryptTotp(secret):null]
    );
    users[role]=String(result.insertId);
  }
  warehouses={};
  for(const [key,kind,agent] of [['central','CENTRAL',null],['agent','AGENT',users.agent],
                                 ['other','AGENT',users.agent2],['sav','SAV',null]]){
    const [result]=await pool.query('INSERT INTO warehouses(name,kind,agent_user_id) VALUES(?,?,?)',
      [key,kind,agent]);
    warehouses[key]=String(result.insertId);
  }
  const [product]=await pool.query("INSERT INTO products(name,category,sku,minimum_level) VALUES('iPhone 13 Casi','iPhone Casi','IPH13-TEST',1)");
  items=[];
  for(const imei of ['351928000004471','351928000004472','351928000009981']){
    const [result]=await pool.query(
      'INSERT INTO items(product_id,warehouse_id,imei,state,location_code) VALUES(?,?,?,\'AVAILABLE\',?)',
      [product.insertId,warehouses.central,imei,'Rayon A2']
    );
    items.push(String(result.insertId));
  }
});

async function token(email,otp){
  const result=await request(app).post(base+'/auth/login').send({email,password:PASSWORD,...(otp?{otp}:{})});
  assert.equal(result.status,200,JSON.stringify(result.body));
  return result.body.accessToken;
}
const bearer=token=>({Authorization:'Bearer '+token});
const payload=(id,agent=users.agent,itemIds=items.slice(0,2))=>({
  requestId:id, sourceWarehouseId:warehouses.central,agentId:agent,itemIds,
});
const requestId=a=>a+'0000000-0000-4000-8000-000000000000'.slice(a.length);

test('Director login is blocked without 2FA and rejects OTP replay',async()=>{
  const missing=await request(app).post(base+'/auth/login').send({email:'director@smtr.test',password:PASSWORD});
  assert.equal(missing.status,401);
  const otp=totpCode(secret,Math.floor(Date.now()/30000));
  const access=await request(app).post(base+'/auth/login').send({email:'director@smtr.test',password:PASSWORD,otp});
  assert.equal(access.status,200,JSON.stringify(access.body));
  assert.equal(access.body.user.role,'director');
  assert.equal(access.body.user.twoFactorVerified,true);
  const replay=await request(app).post(base+'/auth/login').send({email:'director@smtr.test',password:PASSWORD,otp});
  assert.equal(replay.status,401);
});

test('Anonymous requests and Agent manipulation of stock are denied',async()=>{
  assert.equal((await request(app).get(base+'/stocks')).status,401);
  const agentToken=await token('agent@smtr.test');
  const head=bearer(agentToken);
  assert.equal((await request(app).get(base+'/stocks/items?warehouseId='+warehouses.central).set(head)).status,403);
  assert.equal((await request(app).post(base+'/stocks/receipts').set(head).send({})).status,403);
  assert.equal((await request(app).post(base+'/transfers').set(head).send(payload(requestId('a')))).status,403);
  const summary=await request(app).get(base+'/stocks').set(head);
  assert.equal(summary.status,200);
  assert.equal(summary.body.categories.length,0);
});

test('Manager transfer is in transit until exact recipient receipt; idempotent retry',async()=>{
  const managerToken=await token('manager@smtr.test'),agentToken=await token('agent@smtr.test');
  const manager=bearer(managerToken),agent=bearer(agentToken);
  const send=await request(app).post(base+'/transfers').set(manager)
    .send(payload(requestId('b')));
  assert.equal(send.status,201,JSON.stringify(send.body));
  const transferId=send.body.transfer.id;
  const replay=await request(app).post(base+'/transfers').set(manager).send(payload(requestId('b')));
  assert.equal(replay.status,200);
  assert.equal(replay.body.transfer.id,transferId);
  assert.equal(replay.body.transfer.replayed,true);
  const pending=await request(app).get(base+'/transfers/pending').set(agent);
  assert.equal(pending.status,200);
  assert.equal(pending.body.transfers.length,1);
  assert.equal(pending.body.transfers[0].items.length,2);
  assert.match(pending.body.transfers[0].items[0].imeiMasked,/^•••/);
  const [before]=await pool.query('SELECT warehouse_id,state FROM items WHERE id=?',[items[0]]);
  assert.equal(before[0].state,'IN_TRANSIT');
  assert.equal(String(before[0].warehouse_id),warehouses.central);
  const partial=await request(app).post(base+'/transfers/'+transferId+'/receive').set(agent).send({itemIds:[items[0]]});
  assert.equal(partial.status,409);
  const received=await request(app).post(base+'/transfers/'+transferId+'/receive').set(agent).send({itemIds:items.slice(0,2)});
  assert.equal(received.status,200,JSON.stringify(received.body));
  assert.equal(received.body.transfer.status,'RECEIVED');
  const duplicate=await request(app).post(base+'/transfers/'+transferId+'/receive').set(agent).send({itemIds:items.slice(0,2)});
  assert.equal(duplicate.status,200);
  assert.equal(duplicate.body.transfer.replayed,true);
  const [afterRows]=await pool.query('SELECT warehouse_id,state FROM items WHERE id IN (?,?)',[...items.slice(0,2)]);
  assert.ok(afterRows.every(row=>row.state==='AVAILABLE'&&String(row.warehouse_id)===warehouses.agent));
  const [logRows]=await pool.query("SELECT id FROM logs WHERE action='TRANSFER_RECEIVED'");
  assert.equal(logRows.length,1);
  const agentStock=await request(app).get(base+'/stocks').set(agent);
  assert.equal(agentStock.status,200);
  assert.equal(agentStock.body.categories[0].available,2);
});

test('A different agent cannot receive a transfer not addressed to them',async()=>{
  const manager=bearer(await token('manager@smtr.test'));
  const agent2=bearer(await token('other@smtr.test'));
  const sent=await request(app).post(base+'/transfers').set(manager).send(payload(requestId('c')));
  assert.equal(sent.status,201);
  assert.equal((await request(app).get(base+'/transfers/'+sent.body.transfer.id).set(agent2)).status,403);
  const forbidden=await request(app).post(base+'/transfers/'+sent.body.transfer.id+'/receive')
    .set(agent2).send({itemIds:items.slice(0,2)});
  assert.equal(forbidden.status,403);
});

test('Two concurrent transfer attempts cannot double-assign a single IMEI',async()=>{
  const manager=bearer(await token('manager@smtr.test'));
  const [first,second]=await Promise.all([
    request(app).post(base+'/transfers').set(manager).send(payload(requestId('d'),users.agent,[items[0]])),
    request(app).post(base+'/transfers').set(manager).send(payload(requestId('e'),users.agent2,[items[0]])),
  ]);
  assert.deepEqual([first.status,second.status].sort(),[201,409]);
  const [rows]=await pool.query("SELECT COUNT(*) AS n FROM transfers_items WHERE item_id=?",[items[0]]);
  assert.equal(rows[0].n,1);
});

test('Discrepancy freezes all items; missing units never return to available stock',async()=>{
  const manager=bearer(await token('manager@smtr.test'));
  const agent=bearer(await token('agent@smtr.test'));
  const sent=await request(app).post(base+'/transfers').set(manager).send(payload(requestId('f')));
  const id=sent.body.transfer.id;
  const outcome=await request(app).post(base+'/transfers/'+id+'/discrepancy').set(agent)
    .send({presentItemIds:[items[0]],reason:'IMEI physiquement manquant dans le colis'});
  assert.equal(outcome.status,200,JSON.stringify(outcome.body));
  assert.equal(outcome.body.transfer.status,'DISCREPANCY');
  const [rows]=await pool.query('SELECT state FROM items WHERE id IN (?,?)',items.slice(0,2));
  assert.deepEqual(rows.map(x=>x.state).sort(),['HOLD','HOLD']);
  const receive=await request(app).post(base+'/transfers/'+id+'/receive').set(agent).send({itemIds:items.slice(0,2)});
  assert.equal(receive.status,409);
});

test('Ramba is rejected as supplier category and IMEI duplicates rollback whole receipt',async()=>{
  const manager=bearer(await token('manager@smtr.test'));
  const forbidden=await request(app).post(base+'/stocks/products').set(manager)
    .send({name:'Stock retour',category:'Ramba',sku:'RAMBA',minimumLevel:0});
  assert.equal(forbidden.status,422);
  const [prods]=await pool.query('SELECT id FROM products LIMIT 1');
  const receipt=await request(app).post(base+'/stocks/receipts').set(manager)
    .send({warehouseId:warehouses.central,productId:String(prods[0].id),items:[
      {imei:'351928000004471',location:'Rayon A2'}, // already exists
      {imei:'351928000006666',location:'Rayon A2'},
    ]});
  assert.equal(receipt.status,409);
  const [none]=await pool.query("SELECT id FROM items WHERE imei='351928000006666'");
  assert.equal(none.length,0);
});

test('Logout invalidates the bearer session server-side',async()=>{
  const manager=await token('manager@smtr.test');
  assert.equal((await request(app).get(base+'/auth/me').set(bearer(manager))).status,200);
  assert.equal((await request(app).post(base+'/auth/logout').set(bearer(manager))).status,204);
  assert.equal((await request(app).get(base+'/stocks').set(bearer(manager))).status,401);
});
