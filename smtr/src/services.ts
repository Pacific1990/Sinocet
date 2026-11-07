import { ApiError, request } from './api';

export async function get<T>(path:string,token:string,signal?:AbortSignal):Promise<T>{
  return request<T>(path,token,{signal});
}
export async function post<T>(path:string,token:string,body:unknown):Promise<T>{
  return request<T>(path,token,{method:'POST',body:JSON.stringify(body)});
}
export async function put<T>(path:string,token:string,body:unknown):Promise<T>{return request<T>(path,token,{method:'PUT',body:JSON.stringify(body)});}
export async function patch<T>(path:string,token:string,body:unknown):Promise<T>{
  return request<T>(path,token,{method:'PATCH',body:JSON.stringify(body)});
}
export function fcfa(value:number|string|null|undefined):string{
  return (Number(value)||0).toLocaleString('fr-FR')+' F';
}
export function shortDate(value:string|null|undefined):string{
  if(!value)return '—';
  const parsed=new Date(value);
  return Number.isNaN(parsed.getTime())?'—':parsed.toLocaleDateString('fr-FR');
}
export const validUuid=():string=>crypto.randomUUID();
export async function exportFile(path:string,token:string,filename:string):Promise<void>{
  if(!path.startsWith('/')||path.startsWith('//')||!/^[-a-zA-Z0-9_./?=&%]+$/.test(path)){
    throw new Error('Chemin de téléchargement invalide.');
  }
  const base=(import.meta.env.VITE_SMTR_API_BASE_URL||'/smtr/api/v1').replace(/\/+$/,'');
  let response:Response;
  try{
    response=await fetch(base+path,{
      headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'omit',
    });
  }catch{throw new ApiError('Téléchargement indisponible.',0);}
  if(!response.ok){
    let message='Le document ne peut pas être généré.';
    try{const data=await response.json();if(data?.message)message=data.message;}catch{/* use default */}
    throw new ApiError(message,response.status);
  }
  const blob=await response.blob();
  if(!blob.size)throw new Error('Le document est vide.');
  const url=URL.createObjectURL(blob);
  try{
    const link=document.createElement('a');
    link.href=url;link.download=filename;link.rel='noopener';
    document.body.append(link);link.click();link.remove();
  }finally{window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
export function displayError(error:unknown,onLogout:()=>void):string{
  if(error instanceof ApiError&&error.status===401){
    onLogout();
    return 'Session expirée. Reconnectez-vous.';
  }
  return error instanceof Error?error.message:'Une erreur est survenue.';
}

export type Person={id:string;name:string;agentId:string;agentName:string;phone:string|null;creditLimitF:number;balanceF:number};
export type SaleItem={
  id:string;name:string;category:string;priceF:number|null;imeiMasked:string;
};
export type Sale={
  id:string;title:string;subtitle:string;agent:string;totalAmountF:number;
  paidAmountF:number;creditAmountF:number;paymentMethod:string;status:string;createdAt:string;
};
export type Debt={
  id:string;saleId:string;customerId:string;customer:string;agent:string;
  amountF:number;initialAmountF:number;creditLimitF:number;dueDate:string;status:string;
};
export type SavCase={
  id:string;saleId:string;itemId:string;customer:string;agent:string;product:string;
  imeiMasked:string;defect:string;resolution:string|null;status:string;
  createdAt:string;resolvedAt:string|null;replacementItemId:string|null;
};
export type Approval={
  id:string;kind:string;status:string;reason:string;requestedBy:string;reviewedBy:string|null;
  saleId:string|null;itemId:string|null;caseId:string|null;
  discountPercent:number|null;resolution:string|null;createdAt:string;
};
export type InventoryRecord={
  id:string;warehouseId:string;warehouseName:string;agentName:string;status:string;
  openedAt:string;finishedAt:string|null;note:string|null;
};
export type WarehouseCard={
  id:string;name:string;kind:string;frozen:boolean;agent:string|null;location:string|null;
  available:number;transit:number;hold:number;sav:number;
};
export type AuditEvent={
  id:string;actor:string;action:string;entity:string;entityId:string|null;
  occurredAt:string;sourceIp:string|null;details:unknown;
};

