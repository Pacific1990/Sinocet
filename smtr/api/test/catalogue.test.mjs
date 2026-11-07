import 'dotenv/config';
import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createPoolFromEnv } from '../src/db.mjs';
import { makeApp } from '../src/app.mjs';
import { encryptTotp, newTotpSecret, totpCode } from '../src/totp.mjs';

const base='/smtr/api/v1';
const PASSWORD='TestPassword-Strong-2026!!';
const MANAGER_PIN='867240';
let pool,app,users={},depots={},productId='',items=[],customerId='',secrets={};
let savedGrants=[],savedMenus=[];
const json=(response)=>JSON.stringify(response.body||{});
const header=token=>({Authorization:'Bearer '+token});
const uid=index=>index+'a1b2c3d4-1234-4123-a123-123456789012'.slice(1);
const uuid=index=>index.charCodeAt(0).toString(16).padStart(8,'0')+'-0000-4000-8000-000000000000';
const tomorrow=()=>{
  const d=new Date();d.setUTCDate(d.getUTCDate()+14);
  return d.toISOString().slice(0,10);
};
async function login(role){
  const email=role+'@sinocet-tests.local';
  const otp=['director','admin'].includes(role)?
    totpCode(secrets[role],Math.floor(Date.now()/30000)):undefined;
  const r=await request(app).post(base+'/auth/login').send({
    email,password:PASSWORD,...(otp?{otp}:{})
  });
  assert.equal(r.status,200,role+' login '+json(r));
  return r.body.accessToken;
}
async function insertItem(imei,warehouse=depots.central){
  const [r]=await pool.query(
    "INSERT INTO items(product_id,warehouse_id,imei,state,location_code) VALUES(?,?,?,'AVAILABLE','A1')",
    [productId,warehouse,imei]
  );
  return String(r.insertId);
}
before(async()=>{
  if(!/_qa$|_test$/.test(process.env.DB_NAME||''))throw Error('Unsafe database for SMTR tests');
  pool=createPoolFromEnv();app=makeApp(pool);
  await pool.query("SELECT 1 FROM system_settings LIMIT 1");
  const [grants]=await pool.query('SELECT role_id,permission_id FROM role_permissions');
  const [menus]=await pool.query('SELECT role_id,menu_id,visible,sort_order FROM role_menus');
  savedGrants=grants.map(r=>[r.role_id,r.permission_id]);
  savedMenus=menus.map(r=>[r.role_id,r.menu_id,r.visible,r.sort_order]);
});
after(async()=>{
  if(pool)await pool.end();
});
beforeEach(async()=>{
  // Each independent fixture gets a fresh rate-limit store; production remains limited.
  app=makeApp(pool);
  // The test database is dedicated to QA. Never purge any real business data.
  const conn=await pool.getConnection();
  try{
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    for(const table of [
      'logs','realtime_tickets','movements','payments','approvals','sav_cases',
      'debts','cash_closures','inventories_lines','inventories','sales','transfers_items',
      'transfers','items','products','customers','warehouses','sessions','users',
    ])await conn.query('TRUNCATE TABLE '+table);
    await conn.query('DELETE FROM role_menus');
    await conn.query('DELETE FROM role_permissions');
    for(const grant of savedGrants)await conn.query(
      'INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)',grant
    );
    for(const menu of savedMenus)await conn.query(
      'INSERT INTO role_menus(role_id,menu_id,visible,sort_order) VALUES(?,?,?,?)',menu
    );
  }finally{
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
    conn.release();
  }
  const [roles]=await pool.query('SELECT id,code FROM roles');
  const roleIds=Object.fromEntries(roles.map(r=>[r.code,r.id]));
  const pass=await argon2.hash(PASSWORD,{type:argon2.argon2id,memoryCost:4096,timeCost:2});
  const pin=await argon2.hash(MANAGER_PIN,{type:argon2.argon2id,memoryCost:4096,timeCost:2});
  users={};secrets={};
  for(const role of ['admin','director','manager','agent','other']){
    const actual=role==='other'?'agent':role;
    const secret=['admin','director'].includes(role)?newTotpSecret():null;
    if(secret)secrets[role]=secret;
    const [r]=await pool.query(
      'INSERT INTO users(email,name,password_hash,role_id,totp_secret_encrypted,approval_pin_hash,credit_limit_f) VALUES(?,?,?,?,?,?,?)',
      [role+'@sinocet-tests.local',role,pass,roleIds[actual],
        secret?encryptTotp(secret):null,role==='manager'?pin:null,role==='agent'?600000:0]
    );
    users[role]=String(r.insertId);
  }
  depots={};
  for(const [key,kind,owner] of [
    ['central','CENTRAL',null],['agent','AGENT',users.agent],
    ['other','AGENT',users.other],['sav','SAV',null],
  ]){
    const [r]=await pool.query('INSERT INTO warehouses(name,kind,agent_user_id) VALUES(?,?,?)',[key,kind,owner]);
    depots[key]=String(r.insertId);
  }
  const [p]=await pool.query(
    'INSERT INTO products(name,sku,category,minimum_level,sale_price_f,purchase_cost_f) VALUES(?,?,?,?,?,?)',
    ['iPhone de QA','TEST-IPHONE-001','iPhone Casi',2,150000,100000]
  );
  productId=String(p.insertId);
  items=[];
  for(const imei of ['351928000004471','351928000004472','351928000004473','351928000004474','351928000004475']){
    items.push(await insertItem(imei));
  }
  const [customer]=await pool.query(
    'INSERT INTO customers(name,phone,agent_user_id,credit_limit_f) VALUES(?,?,?,?)',
    ['Client test autorisé','2250707000000',users.agent,350000]
  );
  customerId=String(customer.insertId);
});
async function agentItem(managerToken,agentToken,itemId=items[0]){
  const sent=await request(app).post(base+'/transfers').set(header(managerToken)).send({
    requestId:uuid('a'),sourceWarehouseId:depots.central,agentId:users.agent,itemIds:[itemId]
  });
  assert.equal(sent.status,201,'transfer '+json(sent));
  const received=await request(app).post(base+'/transfers/'+sent.body.transfer.id+'/receive')
    .set(header(agentToken)).send({itemIds:[itemId]});
  assert.equal(received.status,200,'receive '+json(received));
  return itemId;
}
async function cashSale(agentToken,itemId,requestToken='b'){
  const r=await request(app).post(base+'/sales').set(header(agentToken)).send({
    requestId:uuid(requestToken),itemId,paymentMethod:'CASH',paidAmountF:150000,
  });
  assert.equal(r.status,201,'cash sale '+json(r));
  return String(r.body.sale.id);
}

test('Administrateur requires TOTP, manages configuration, never sees business data',async()=>{
  const noOtp=await request(app).post(base+'/auth/login').send({
    email:'admin@sinocet-tests.local',password:PASSWORD
  });
  assert.equal(noOtp.status,401);
  const token=await login('admin');
  assert.equal((await request(app).get(base+'/system/overview').set(header(token))).status,200);
  const me=await request(app).get(base+'/access/me').set(header(token));
  assert.equal(me.status,200,json(me));
  assert.ok(me.body.navigation.some(x=>x.id==='permissions'));
  assert.equal(me.body.navigation.some(x=>x.id==='sales'),false);
  for(const path of ['/stocks','/sales','/finance/agents','/reports','/dashboard/summary']){
    assert.equal((await request(app).get(base+path).set(header(token))).status,403,path);
  }
  const person=await request(app).get(base+'/users').set(header(token));
  assert.equal(person.status,200,json(person));
  assert.equal(JSON.stringify(person.body).includes('creditLimitF'),false);
  const create=await request(app).post(base+'/users').set(header(token)).send({
    name:'Nouveau agent',email:'newagent@sinocet-tests.local',role:'agent',
    warehouseName:'Stock agent supplémentaire',temporaryPassword:'VeryStrongNewPassword2026!',
  });
  assert.equal(create.status,201,json(create));
  const [wh]=await pool.query('SELECT id FROM warehouses WHERE agent_user_id=?',[create.body.user.id]);
  assert.equal(wh.length,1);
  assert.equal((await request(app).put(base+'/system/roles/admin/permissions').set(header(token))
    .send({permissions:['sales.create','dashboard.view']})).status,422);
  const director=await login('director');
  assert.equal((await request(app).get(base+'/system/overview').set(header(director))).status,403);
});

test('Administrator can remove Agent sale rights, revoke sessions and configure menus',async()=>{
  const admin=await login('admin');
  const agent=await login('agent');
  assert.equal((await request(app).get(base+'/access/me').set(header(agent))).status,200);
  const grants=await request(app).get(base+'/system/permissions').set(header(admin));
  assert.equal(grants.status,200);
  const newCodes=grants.body.grants.agent.filter(x=>x!=='sales.create');
  const changed=await request(app).put(base+'/system/roles/agent/permissions').set(header(admin))
    .send({permissions:newCodes});
  assert.equal(changed.status,200,json(changed));
  assert.equal((await request(app).get(base+'/access/me').set(header(agent))).status,401);
  const agentAgain=await login('agent');
  const newAccess=await request(app).get(base+'/access/me').set(header(agentAgain));
  assert.equal(newAccess.status,200);
  assert.equal(newAccess.body.permissions.includes('sales.create'),false);
  assert.equal((await request(app).post(base+'/sales').set(header(agentAgain)).send({})).status,403);
  const menus=await request(app).put(base+'/system/roles/manager/menus').set(header(admin))
    .send({menus:['dashboard','stocks','transfers']});
  assert.equal(menus.status,200,json(menus));
  const manager=await login('manager');
  const managerMenus=await request(app).get(base+'/access/me').set(header(manager));
  assert.deepEqual(managerMenus.body.navigation.map(x=>x.id),['dashboard','stocks','transfers']);
});

test('Manager sends, Agent receives, sale is unique with PDF receipt',async()=>{
  const manager=await login('manager'),agent=await login('agent'),director=await login('director');
  const itemId=await agentItem(manager,agent);
  const r=await request(app).post(base+'/sales').set(header(agent)).send({
    requestId:uuid('b'),itemId,paymentMethod:'CASH',paidAmountF:150000,
  });
  assert.equal(r.status,201,json(r));
  const repeat=await request(app).post(base+'/sales').set(header(agent)).send({
    requestId:uuid('b'),itemId,paymentMethod:'CASH',paidAmountF:150000,
  });
  assert.equal(repeat.status,200,json(repeat));
  assert.equal(repeat.body.sale.id,r.body.sale.id);
  const [item]=await pool.query('SELECT state FROM items WHERE id=?',[itemId]);
  assert.equal(item[0].state,'SOLD');
  const tooLate=await request(app).post(base+'/sales').set(header(agent)).send({
    requestId:uuid('c'),itemId,paymentMethod:'CASH',paidAmountF:150000,
  });
  assert.equal(tooLate.status,409);
  const pdf=await request(app).get(base+'/sales/'+r.body.sale.id+'/receipt').set(header(agent));
  assert.equal(pdf.status,200,json(pdf));
  assert.match(pdf.headers['content-type'],/pdf/);
  assert.ok(pdf.body?.length>300 || pdf.text?.length>300);
  const fromOther=await request(app).get(base+'/sales/'+r.body.sale.id+'/receipt')
    .set(header(await login('other')));
  assert.equal(fromOther.status,403);
  const report=await request(app).get(base+'/reports/sales?format=xlsx').set(header(director));
  assert.equal(report.status,200,json(report));
  assert.match(report.headers['content-type'],/spreadsheetml/);
});


test('Credit sale respects both ceilings, repayment is idempotent and cash closes once',async()=>{
  const manager=await login('manager'),agent=await login('agent');
  await agentItem(manager,agent);
  const invalid=await request(app).post(base+'/sales').set(header(agent)).send({
    requestId:uuid('g'),itemId:items[0],customerId,paidAmountF:100,
    paymentMethod:'CREDIT',collectedVia:'CASH',dueDate:tomorrow(),
  });
  assert.equal(invalid.status,201,'sale '+json(invalid));
  const [debts]=await pool.query('SELECT id,remaining_amount_f FROM debts WHERE sale_id=?',[invalid.body.sale.id]);
  assert.equal(debts.length,1);
  assert.equal(Number(debts[0].remaining_amount_f),149900);
  const debtId=String(debts[0].id);
  const first=await request(app).post(base+'/debts/'+debtId+'/payments')
    .set(header(agent)).send({
      requestId:uuid('h'),amountF:50000,method:'MOBILE_MONEY',
      reference:'TEST-PAID-0001',
    });
  assert.equal(first.status,201,'repay '+json(first));
  assert.equal(first.body.payment.remainingF,99900);
  const repeat=await request(app).post(base+'/debts/'+debtId+'/payments')
    .set(header(agent)).send({
      requestId:uuid('h'),amountF:50000,method:'MOBILE_MONEY',
      reference:'TEST-PAID-0001',
    });
  assert.equal(repeat.status,200,json(repeat));
  const [payments]=await pool.query("SELECT id FROM payments WHERE debt_id=?",[debtId]);
  assert.equal(payments.length,1);
  const today=await request(app).get(base+'/cash/today').set(header(agent));
  assert.equal(today.status,200,json(today));
  assert.equal(today.body.expected.cashF,100);
  assert.equal(today.body.expected.mobileF,50000);
  const credits=await request(app).get(base+'/debts').set(header(agent));
  assert.equal(credits.body.summary.recoveredThisMonthF,50000);
  assert.equal(typeof credits.body.summary.overdueCustomersCount,'number');
  const closure=await request(app).post(base+'/cash/close').set(header(agent)).send({
    declaredCashF:100,declaredMobileF:50000,declaredTransferF:0,
  });
  assert.equal(closure.status,201,json(closure));
  assert.equal((await request(app).post(base+'/cash/close').set(header(agent)).send({
    declaredCashF:100,declaredMobileF:50000,declaredTransferF:0,
  })).status,409);
  const receipt=await request(app).get(base+'/payments/'+payments[0].id+'/receipt').set(header(agent));
  assert.equal(receipt.status,200,'payment pdf '+json(receipt));
});

test('Ceiling prevents unauthorized customer or Agent debt',async()=>{
  const manager=await login('manager'),agent=await login('agent'),director=await login('director');
  await agentItem(manager,agent);
  const limit=await request(app).patch(base+'/finance/agents/'+users.agent+'/limit').set(header(director))
    .send({creditLimitF:100000});
  assert.equal(limit.status,200,json(limit));
  const tooMuch=await request(app).post(base+'/sales').set(header(agent)).send({
    requestId:uuid('i'),itemId:items[0],customerId,paidAmountF:0,
    paymentMethod:'CREDIT',dueDate:tomorrow(),
  });
  assert.equal(tooMuch.status,409,json(tooMuch));
  const [item]=await pool.query('SELECT state FROM items WHERE id=?',[items[0]]);
  assert.equal(item[0].state,'AVAILABLE');
});

test('Manager PIN validates a discount; sale uses approved percentage exactly once',async()=>{
  const manager=await login('manager'),agent=await login('agent');
  await agentItem(manager,agent);
  const requested=await request(app).post(base+'/approvals').set(header(agent)).send({
    kind:'DISCOUNT',itemId:items[0],discountPercent:10,
    reason:'Client fidèle et remise demandée sur place',
  });
  assert.equal(requested.status,201,json(requested));
  const approved=await request(app).post(base+'/approvals/'+requested.body.approval.id+'/decision')
    .set(header(manager)).send({decision:'APPROVED',approvalCode:MANAGER_PIN});
  assert.equal(approved.status,200,json(approved));
  const sale=await request(app).post(base+'/sales').set(header(agent)).send({
    requestId:uuid('j'),itemId:items[0],paymentMethod:'CASH',paidAmountF:135000,
    approvalId:requested.body.approval.id,
  });
  assert.equal(sale.status,201,json(sale));
  assert.equal(sale.body.sale.totalAmountF,135000);
  const [ap]=await pool.query('SELECT status FROM approvals WHERE id=?',[requested.body.approval.id]);
  assert.equal(ap[0].status,'APPLIED');
  assert.equal((await request(app).post(base+'/approvals/'+requested.body.approval.id+'/decision')
    .set(header(manager)).send({decision:'APPROVED',approvalCode:MANAGER_PIN})).status,409);
});

test('Agent SAV is isolated in Ramba, Manager resolves approved refund',async()=>{
  const manager=await login('manager'),agent=await login('agent');
  await agentItem(manager,agent);
  const saleId=await cashSale(agent,items[0],'k');
  const opened=await request(app).post(base+'/cases').set(header(agent)).send({
    saleId,defect:'L’écran d’origine ne fonctionne plus',
    factoryDefectConfirmed:true,
  });
  assert.equal(opened.status,201,json(opened));
  const caseId=opened.body.case.id;
  const [item]=await pool.query('SELECT state,warehouse_id FROM items WHERE id=?',[items[0]]);
  assert.equal(item[0].state,'SAV');
  assert.equal(String(item[0].warehouse_id),depots.sav);
  assert.equal((await request(app).get(base+'/cases/warehouse').set(header(agent))).status,403);
  const approval=await request(app).post(base+'/approvals').set(header(agent)).send({
    kind:'SAV_RESOLUTION',caseId,resolution:'REFUND',
    reason:'Appareil déclaré irréparable suite au contrôle',
  });
  assert.equal(approval.status,201,json(approval));
  const signed=await request(app).post(base+'/approvals/'+approval.body.approval.id+'/decision')
    .set(header(manager)).send({decision:'APPROVED',approvalCode:MANAGER_PIN});
  assert.equal(signed.status,200,json(signed));
  const refund=await request(app).post(base+'/cases/'+caseId+'/resolve').set(header(manager))
    .send({approvalId:approval.body.approval.id,refundConfirmed:true,
      refundMethod:'CASH',refundReference:'CASH-TEST-REFUND',requestId:uuid('l')});
  assert.equal(refund.status,200,json(refund));
  assert.equal(refund.body.case.resolution,'REFUND');
  assert.equal(refund.body.case.refundF,150000);
  const [sale]=await pool.query('SELECT status FROM sales WHERE id=?',[saleId]);
  assert.equal(sale[0].status,'CANCELLED');
  const [after]=await pool.query('SELECT state FROM items WHERE id=?',[items[0]]);
  assert.equal(after[0].state,'SAV');
  const [logs]=await pool.query("SELECT action FROM logs WHERE action='SAV_RESOLVED'");
  assert.equal(logs.length,1);
});



test('Inventory discrepancy blocks unfreeze until physical IMEI reconciliation',async()=>{
  const manager=await login('manager'),agent=await login('agent');
  await agentItem(manager,agent);
  // Agent stock item 0 now available. Set one other item in agent stock to reproduce shortage.
  await insertItem('351928000009991',depots.agent);
  const started=await request(app).post(base+'/inventories/start').set(header(manager))
    .send({warehouseId:depots.agent});
  assert.equal(started.status,201,json(started));
  const invId=started.body.inventory.id;
  const frozenSale=await request(app).post(base+'/sales').set(header(agent)).send({
    requestId:uuid('m'),itemId:items[0],paymentMethod:'CASH',paidAmountF:150000
  });
  assert.equal(frozenSale.status,409);
  const detailed=await request(app).get(base+'/inventories/'+invId).set(header(manager));
  assert.equal(detailed.status,200,json(detailed));
  assert.equal(detailed.body.inventory.lines.length,1);
  const closed=await request(app).post(base+'/inventories/'+invId+'/close').set(header(manager))
    .send({counts:[{productId,counted:1}],note:'Un article manquant au comptage réel'});
  assert.equal(closed.status,200,json(closed));
  assert.equal(closed.body.inventory.frozen,true);
  const unsafe=await request(app).post(base+'/inventories/warehouses/'+depots.agent+'/freeze')
    .set(header(manager)).send({frozen:false,reason:'On voudrait vendre sans contrôle'});
  assert.equal(unsafe.status,409,json(unsafe));
  const stock=await request(app).get(base+'/inventories/'+invId+'/items').set(header(manager));
  assert.equal(stock.status,200,json(stock));
  assert.equal(stock.body.items.length,2);
  const actual=stock.body.items.find(x=>x.id===items[0]);
  assert.ok(actual);
  const reconciled=await request(app).post(base+'/inventories/'+invId+'/reconcile')
    .set(header(manager)).send({
      verifiedItemIds:[items[0]],reason:'Seul cet appareil a été retrouvé physiquement'
    });
  assert.equal(reconciled.status,200,json(reconciled));
  assert.equal(reconciled.body.inventory.missingCount,1);
  const [state]=await pool.query('SELECT id,state FROM items WHERE warehouse_id=? ORDER BY id',[depots.agent]);
  assert.equal(state.filter(x=>x.state==='HOLD').length,1);
  assert.equal(state.filter(x=>x.state==='AVAILABLE').length,1);
  const good=await request(app).post(base+'/sales').set(header(agent)).send({
    requestId:uuid('n'),itemId:items[0],paymentMethod:'CASH',paidAmountF:150000
  });
  assert.equal(good.status,201,json(good));
  const missing=String(state.find(x=>x.state==='HOLD').id);
  const denied=await request(app).post(base+'/sales').set(header(agent)).send({
    requestId:uuid('o'),itemId:missing,paymentMethod:'CASH',paidAmountF:150000
  });
  assert.equal(denied.status,409);
});

test('Transfer discrepancy reconciliation releases only physically returned IMEI',async()=>{
  const manager=await login('manager'),agent=await login('agent');
  const sent=await request(app).post(base+'/transfers').set(header(manager)).send({
    requestId:uuid('p'),sourceWarehouseId:depots.central,
    agentId:users.agent,itemIds:items.slice(0,2)
  });
  assert.equal(sent.status,201,json(sent));
  const transferId=sent.body.transfer.id;
  const report=await request(app).post(base+'/transfers/'+transferId+'/discrepancy')
    .set(header(agent)).send({
      presentItemIds:[items[0]],reason:'Deux IMEI annoncés et un seul reçu physiquement'
    });
  assert.equal(report.status,200,json(report));
  const failed=await request(app).post(base+'/transfers/'+transferId+'/resolve')
    .set(header(manager)).send({verifiedItemIds:[items[2]],reason:'Mauvais IMEI vérifié'});
  assert.equal(failed.status,422);
  const resolved=await request(app).post(base+'/transfers/'+transferId+'/resolve')
    .set(header(manager)).send({
      verifiedItemIds:[items[0]],reason:'Le téléphone est retourné physiquement au Central'
    });
  assert.equal(resolved.status,200,json(resolved));
  assert.equal(resolved.body.transfer.status,'CLOSED_WITH_DISCREPANCY');
  const [stock]=await pool.query('SELECT id,state,warehouse_id FROM items WHERE id IN (?,?)',
    [items[0],items[1]]);
  assert.equal(stock.find(x=>String(x.id)===items[0]).state,'AVAILABLE');
  assert.equal(stock.find(x=>String(x.id)===items[1]).state,'HOLD');
  const retry=await request(app).post(base+'/transfers/'+transferId+'/resolve')
    .set(header(manager)).send({
      verifiedItemIds:[items[1]],reason:'Ne peut pas confirmer un IMEI manquant'
    });
  assert.equal(retry.status,409);
});

test('Excel importer validates text IMEI, rejects duplicate lot and preserves stock',async()=>{
  const manager=await login('manager');
  const book=new ExcelJS.Workbook();
  const ws=book.addWorksheet('Arrivage');
  ws.addRow(['SKU','IMEI','EMPLACEMENT']);
  ws.addRow(['TEST-IPHONE-001','351928000004488','Rayon A3']);
  const buffer=Buffer.from(await book.xlsx.writeBuffer());
  const ok=await request(app).post(base+'/stocks/import')
    .set(header(manager)).field('warehouseId',depots.central)
    .attach('file',buffer,'lot_imei.xlsx');
  assert.equal(ok.status,201,json(ok));
  assert.equal(ok.body.import.quantity,1);
  const duplicate=await request(app).post(base+'/stocks/import')
    .set(header(manager)).field('warehouseId',depots.central)
    .attach('file',buffer,'lot_imei.xlsx');
  assert.equal(duplicate.status,409,json(duplicate));
  const [itemsFound]=await pool.query("SELECT id FROM items WHERE imei='351928000004488'");
  assert.equal(itemsFound.length,1);
});

test('Audit log cannot be deleted or modified by the application',async()=>{
  const manager=await login('manager');
  await request(app).post(base+'/stocks/products').set(header(manager))
    .send({name:'Écouteurs QA',category:'Écouteurs',sku:'TEST-EAR-42',minimumLevel:2});
  const [rows]=await pool.query('SELECT id FROM logs ORDER BY id DESC LIMIT 1');
  assert.ok(rows.length);
  await assert.rejects(pool.query('DELETE FROM logs WHERE id=?',[rows[0].id]));
  await assert.rejects(pool.query('UPDATE logs SET action=? WHERE id=?',
    ['EVASION',rows[0].id]));
});


async function approvedSav(manager,agent,saleId,resolution){
  const opened=await request(app).post(base+'/cases').set(header(agent)).send({saleId,defect:'Defaut usine constate au controle QA',factoryDefectConfirmed:true});
  assert.equal(opened.status,201,json(opened));
  const caseId=opened.body.case.id;
  const requested=await request(app).post(base+'/approvals').set(header(agent)).send({kind:'SAV_RESOLUTION',caseId,resolution,reason:'Resolution apres controle du defaut usine'});
  assert.equal(requested.status,201,json(requested));
  const signed=await request(app).post(base+'/approvals/'+requested.body.approval.id+'/decision').set(header(manager)).send({decision:'APPROVED',approvalCode:MANAGER_PIN});
  assert.equal(signed.status,200,json(signed));
  return {caseId,approvalId:requested.body.approval.id};
}
test('Repaired IMEI can be resold without letting historical sale seize the new customer device',async()=>{
  const manager=await login('manager'),agent=await login('agent');
  await agentItem(manager,agent);
  const original=await cashSale(agent,items[0],'m');
  const {caseId,approvalId}=await approvedSav(manager,agent,original,'REPAIR');
  const repaired=await request(app).post(base+'/cases/'+caseId+'/resolve').set(header(manager)).send({approvalId});
  assert.equal(repaired.status,200,json(repaired));
  assert.equal((await request(app).post(base+'/cases/'+caseId+'/release').set(header(manager)).send({centralWarehouseId:depots.central})).status,422);
  const released=await request(app).post(base+'/cases/'+caseId+'/release').set(header(manager)).send({centralWarehouseId:depots.central,repairVerified:true});
  assert.equal(released.status,200,json(released));
  const sent=await request(app).post(base+'/transfers').set(header(manager)).send({requestId:uuid('n'),sourceWarehouseId:depots.central,agentId:users.agent,itemIds:[items[0]]});
  assert.equal(sent.status,201,json(sent));
  assert.equal((await request(app).post(base+'/transfers/'+sent.body.transfer.id+'/receive').set(header(agent)).send({itemIds:[items[0]]})).status,200);
  const second=await cashSale(agent,items[0],'o');
  const oldReturn=await request(app).post(base+'/cases').set(header(agent)).send({saleId:original,defect:'Ancienne facture ne doit pas saisir le nouvel appareil',factoryDefectConfirmed:true});
  assert.equal(oldReturn.status,409,json(oldReturn));
  const [[device]]=await pool.query('SELECT state,current_sale_id FROM items WHERE id=?',[items[0]]);
  assert.equal(device.state,'SOLD');assert.equal(String(device.current_sale_id),second);
  const [history]=await pool.query('SELECT id FROM sales WHERE item_id=?',[items[0]]);
  assert.equal(history.length,2);
});
test('SAV exchange preserves invoice IMEI, assigns replacement and permits its factory return',async()=>{
  const manager=await login('manager'),agent=await login('agent');
  await agentItem(manager,agent);
  const saleId=await cashSale(agent,items[0],'p');
  const {caseId,approvalId}=await approvedSav(manager,agent,saleId,'EXCHANGE');
  const exchange=await request(app).post(base+'/cases/'+caseId+'/resolve').set(header(manager)).send({approvalId,replacementItemId:items[1]});
  assert.equal(exchange.status,200,json(exchange));
  const [[invoice]]=await pool.query('SELECT item_id FROM sales WHERE id=?',[saleId]);
  assert.equal(String(invoice.item_id),items[0]);
  const [[replacement]]=await pool.query('SELECT state,current_sale_id FROM items WHERE id=?',[items[1]]);
  assert.equal(replacement.state,'SOLD');assert.equal(String(replacement.current_sale_id),saleId);
  const returned=await request(app).post(base+'/cases').set(header(agent)).send({saleId,defect:'Defaut usine sur appareil fourni en remplacement',factoryDefectConfirmed:true});
  assert.equal(returned.status,201,json(returned));
  const [[newCase]]=await pool.query('SELECT item_id FROM sav_cases WHERE id=?',[returned.body.case.id]);
  assert.equal(String(newCase.item_id),items[1]);
});
test('Approved cancellation checks physical IMEI and restores cash and stock once',async()=>{
  const manager=await login('manager'),agent=await login('agent');
  await agentItem(manager,agent);
  const saleId=await cashSale(agent,items[0],'q');
  const requested=await request(app).post(base+'/approvals').set(header(agent)).send({kind:'CANCEL_SALE',saleId,reason:'Erreur de vente verifiee avec retour physique'});
  assert.equal(requested.status,201,json(requested));
  const approvalId=requested.body.approval.id;
  assert.equal((await request(app).post(base+'/approvals/'+approvalId+'/decision').set(header(manager)).send({decision:'APPROVED',approvalCode:MANAGER_PIN})).status,200);
  const payload={approvalId,returnedImei:'351928000004472',refundMethod:'CASH',requestId:uuid('r')};
  assert.equal((await request(app).post(base+'/approvals/sales/'+saleId+'/cancel').set(header(manager)).send(payload)).status,409);
  payload.returnedImei='351928000004471';
  const cancelled=await request(app).post(base+'/approvals/sales/'+saleId+'/cancel').set(header(manager)).send(payload);
  assert.equal(cancelled.status,200,json(cancelled));
  assert.equal(cancelled.body.sale.refundF,150000);
  assert.equal((await request(app).post(base+'/approvals/sales/'+saleId+'/cancel').set(header(manager)).send(payload)).status,409);
  const [[device]]=await pool.query('SELECT state,current_sale_id FROM items WHERE id=?',[items[0]]);
  assert.equal(device.state,'AVAILABLE');assert.equal(device.current_sale_id,null);
  const cash=await request(app).get(base+'/cash/today').set(header(agent));
  assert.equal(cash.body.expected.totalF,0);
});
test('Reports generate real PDF and Excel content, enforce roles and reject inverted periods',async()=>{
  const manager=await login('manager'),agent=await login('agent');
  await agentItem(manager,agent);await cashSale(agent,items[0],'s');
  for(const kind of ['sales','stock_variance','sav_monthly','debts']){
    const pdf=await request(app).get(base+'/reports/'+kind+'?format=pdf').set(header(manager));
    assert.equal(pdf.status,200,json(pdf));assert.match(pdf.headers['content-type'],/application\/pdf/);
    const excel=await request(app).get(base+'/reports/'+kind+'?format=xlsx').buffer(true).parse((res,done)=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>done(null,Buffer.concat(chunks)));}).set(header(manager));
    assert.equal(excel.status,200,json(excel));
    const book=new ExcelJS.Workbook();await book.xlsx.load(excel.body);
    assert.ok(book.worksheets[0].rowCount>=4);
    assert.equal((await request(app).get(base+'/reports/'+kind).set(header(agent))).status,403);
  }
  assert.equal((await request(app).get(base+'/reports/sales?from=2026-02-02&to=2026-01-01').set(header(manager))).status,422);
});

test('WebSocket ticket is consumed once and invalidations contain no business data',async()=>{
  const {createServer}=await import('node:http');
  const {WebSocket}=await import('ws');
  const {attachRealtime,realtimeBus}=await import('../src/realtime.mjs');
  const manager=await login('manager');
  const ticket=await request(app).post(base+'/events/ticket').set(header(manager)).send({});
  assert.equal(ticket.status,200,json(ticket));
  const server=createServer(app);const wss=attachRealtime(server,pool);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const url='ws://127.0.0.1:'+port+'/smtr/ws?ticket='+ticket.body.ticket;
  const origin='http://127.0.0.1:'+port;
  let socket;
  try{
    socket=new WebSocket(url,{origin});
    const first=await new Promise((resolve,reject)=>{socket.once('message',m=>resolve(JSON.parse(String(m))));socket.once('error',reject);});
    assert.equal(first.event,'connected');
    const next=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Missing invalidation')),3000);socket.once('message',m=>{clearTimeout(timeout);resolve(JSON.parse(String(m)));});});
    realtimeBus.emit('refresh',{resource:'stocks'});
    const refresh=await next;
    assert.equal(refresh.event,'refresh');assert.equal(refresh.resource,'stocks');
    assert.deepEqual(Object.keys(refresh).sort(),['at','event','resource']);
    const replay=new WebSocket(url,{origin});
    const refused=await new Promise(resolve=>{replay.once('open',()=>resolve(false));replay.once('error',()=>resolve(true));});
    assert.equal(refused,true);replay.terminate();
  }finally{
    socket?.terminate();for(const client of wss.clients)client.terminate();
    await new Promise(resolve=>server.close(resolve));
  }
});

test('Administrator reads and updates JSON string and numeric settings without double decoding',async()=>{
  const admin=await login('admin');
  const all=await request(app).get(base+'/system/settings').set(header(admin));
  assert.equal(all.status,200,json(all));
  assert.equal(typeof all.body.settings.find(s=>s.key==='company.name').value,'string');
  assert.equal(typeof all.body.settings.find(s=>s.key==='alerts.transit_days').value,'number');
  const updated=await request(app).put(base+'/system/settings/company.name').set(header(admin)).send({value:'Groupe Sinocet Electronics QA'});
  assert.equal(updated.status,200,json(updated));
  const read=await request(app).get(base+'/system/settings').set(header(admin));
  assert.equal(read.body.settings.find(s=>s.key==='company.name').value,'Groupe Sinocet Electronics QA');
  const restore=await request(app).put(base+'/system/settings/company.name').set(header(admin)).send({value:'Groupe Sinocet Electronics'});
  assert.equal(restore.status,200,json(restore));
});

test('Configured company and page size reach clients and alert thresholds change dashboard results',async()=>{
  const admin=await login('admin'),manager=await login('manager'),agent=await login('agent');
  const changed=await request(app).put(base+'/system/settings/ui.page_size').set(header(admin)).send({value:10});
  assert.equal(changed.status,200,json(changed));
  const access=await request(app).get(base+'/access/me').set(header(agent));
  assert.equal(access.body.settings.pageSize,10);
  assert.equal(typeof access.body.settings.companyName,'string');
  const sent=await request(app).post(base+'/transfers').set(header(manager)).send({requestId:uuid('u'),sourceWarehouseId:depots.central,agentId:users.agent,itemIds:[items[0]]});
  assert.equal(sent.status,201,json(sent));
  await pool.query('UPDATE transfers SET sent_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 4 DAY) WHERE id=?',[sent.body.transfer.id]);
  assert.equal((await request(app).put(base+'/system/settings/alerts.transit_days').set(header(admin)).send({value:3})).status,200);
  const late=await request(app).get(base+'/dashboard/overview').set(header(manager));
  assert.equal(late.status,200,json(late));assert.ok(late.body.alerts.some(x=>x.id==='late'));
  assert.equal((await request(app).put(base+'/system/settings/alerts.transit_days').set(header(admin)).send({value:6})).status,200);
  const onTime=await request(app).get(base+'/dashboard/overview').set(header(manager));
  assert.equal(onTime.status,200,json(onTime));assert.equal(onTime.body.alerts.some(x=>x.id==='late'),false);
  await request(app).put(base+'/system/settings/alerts.transit_days').set(header(admin)).send({value:2});
  await request(app).put(base+'/system/settings/ui.page_size').set(header(admin)).send({value:25});
});
