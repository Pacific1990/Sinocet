// Offline records are drafts. The server rechecks stock, price and credit on submission.
export type OfflineSaleDraft={
  requestId:string;ownerId:string;itemId:string;customerId:string|null;
  approvalId?:string;
  paymentMethod:'CASH'|'MOBILE_MONEY'|'TRANSFER'|'CREDIT';
  paidAmountF:number;collectedVia?:string;dueDate?:string;
  paymentReference?:string;createdAt:number;
};
const DB_NAME='smtr_offline_drafts_v1';
const STORE='sales';
function database():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)){reject(new Error('Stockage hors ligne indisponible.'));return;}
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{
      if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'requestId'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(new Error('Impossible d’accéder aux brouillons.'));
  });
}
async function run<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode);
    let value:T;
    // A request success is not a commit: quota/abort errors must never report success.
    tx.oncomplete=()=>{db.close();resolve(value);};
    tx.onabort=tx.onerror=()=>{db.close();reject(new Error('Stockage des brouillons interrompu.'));};
    try{
      const req=action(tx.objectStore(STORE));
      req.onsuccess=()=>{value=req.result;};
    }catch(error){tx.abort();db.close();reject(error);}
  });
}
export async function addDraft(draft:OfflineSaleDraft):Promise<void>{
  // No credentials, client name, phone or full IMEI is stored.
  await run('readwrite',store=>store.put(draft));
}
export async function listDrafts(ownerId:string):Promise<OfflineSaleDraft[]>{
  const all=await run<OfflineSaleDraft[]>('readonly',store=>store.getAll());
  return all.filter(x=>x.ownerId===ownerId).sort((a,b)=>a.createdAt-b.createdAt);
}
export async function deleteDraft(requestId:string):Promise<void>{
  await run('readwrite',store=>store.delete(requestId));
}
