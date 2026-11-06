import { isRole, type Role } from './permissions';

export interface AuthenticatedUser {
  id: string;
  name: string;
  role: Role;
  twoFactorVerified: boolean;
}
export interface Session {
  accessToken: string;
  user: AuthenticatedUser;
}
export interface SummaryMetric {
  id: string;
  label: string;
  value: string;
  hint?: string;
}
export interface ListRecord {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  status?: string;
}
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE_URL = (import.meta.env.VITE_SMTR_API_BASE_URL || '/smtr/api/v1').replace(/\/+$/, '');

export async function request<T>(path: string, token: string | null, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE_URL + path, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    throw new ApiError('API indisponible. Vérifiez la connexion et la configuration du serveur.', 0);
  }
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const detail = body && typeof body === 'object' && 'message' in body
      ? String(body.message) : 'Le serveur a refusé cette opération.';
    throw new ApiError(detail, res.status);
  }
  return body as T;
}

export async function login(email: string, password: string, otp?: string): Promise<Session> {
  const raw = await request<unknown>('/auth/login', null, {
    method: 'POST', body: JSON.stringify({ email, password, ...(otp ? { otp } : {}) }),
  });
  if (!raw || typeof raw !== 'object') throw new ApiError('Réponse d’authentification invalide.', 502);
  const data = raw as Record<string, unknown>;
  const user = data.user as Record<string, unknown> | undefined;
  if (typeof data.accessToken !== 'string' || !data.accessToken ||
      !user || !isRole(user.role) || typeof user.id !== 'string' ||
      typeof user.name !== 'string') {
    throw new ApiError('Contrat d’authentification non reconnu.', 502);
  }
  if (user.role === 'director' && user.twoFactorVerified !== true) {
    throw new ApiError('Authentification à deux facteurs requise pour la Direction.', 403);
  }
  return {
    accessToken: data.accessToken,
    user: {
      id: user.id, name: user.name, role: user.role,
      twoFactorVerified: user.twoFactorVerified === true,
    },
  };
}

export async function fetchMetrics(token: string, signal?: AbortSignal): Promise<SummaryMetric[]> {
  const result = await request<{metrics: SummaryMetric[]}>('/dashboard/summary', token, {signal});
  if (!result || !Array.isArray(result.metrics)) throw new ApiError('Format du tableau de bord non reconnu.', 502);
  return result.metrics;
}

export async function fetchList(path: string, token: string, signal?: AbortSignal): Promise<ListRecord[]> {
  const result = await request<{items: ListRecord[]}>(path, token, {signal});
  if (!result || !Array.isArray(result.items)) throw new ApiError('Format de liste non reconnu.', 502);
  return result.items;
}


// Real operational API contracts. No fallback values / mock datasets.
export type StockCategory = {
  id:string; name:string; available:number; minimumLevel:number; location:string; status:string;
};
export type CentralWarehouse = {id:string;name:string;location:string | null};
export type StockProduct = {id:string;name:string;sku:string;category:string;minimumLevel:number};
export type StockItem = {id:string;imeiMasked:string;productName:string;location:string};
export type AgentDestination = {id:string;name:string;warehouseId:string;warehouseName:string};
export type TransferRecord = {id:string;status:string;agentName:string;sentAt:string;quantity:number};
export type PendingTransfer = {
  id:string;source:string;sentAt:string;
  items:Array<{id:string;imeiMasked:string;productName:string}>;
};
export function listStock(token:string){
  return request<{categories:StockCategory[]}>('/stocks',token);
}
export function listCentralWarehouses(token:string){
  return request<{warehouses:CentralWarehouse[]}>('/stocks/central-warehouses',token);
}
export function listAgents(token:string){
  return request<{agents:AgentDestination[]}>('/stocks/agents',token);
}
export function listProducts(token:string){
  return request<{products:StockProduct[]}>('/stocks/products',token);
}
export function listStockItems(token:string,warehouseId:string,q=''){
  const query = new URLSearchParams({warehouseId,q});
  return request<{items:StockItem[]}>('/stocks/items?'+query,token);
}
export function receiveStock(token:string,body:{
  warehouseId:string;productId:string;items:Array<{imei:string;location:string}>;
}){
  return request<{quantity:number;itemIds:string[]}>('/stocks/receipts',token,{
    method:'POST',body:JSON.stringify(body),
  });
}
export function listTransfers(token:string){
  return request<{transfers:TransferRecord[]}>('/transfers',token);
}
export function startTransfer(token:string,body:{
  requestId:string;sourceWarehouseId:string;agentId:string;itemIds:string[];
}){
  return request<{transfer:{id:string;status:string;replayed:boolean}}>('/transfers',token,{
    method:'POST',body:JSON.stringify(body),
  });
}
export function listPendingTransfers(token:string){
  return request<{transfers:PendingTransfer[]}>('/transfers/pending',token);
}
export function receiveTransfer(token:string,id:string,itemIds:string[]){
  return request<{transfer:{id:string;status:string;replayed:boolean}}>('/transfers/'+id+'/receive',token,{
    method:'POST',body:JSON.stringify({itemIds}),
  });
}
export function reportTransferDiscrepancy(token:string,id:string,presentItemIds:string[],reason:string){
  return request<{transfer:{id:string;status:string;missingCount:number}}>('/transfers/'+id+'/discrepancy',token,{
    method:'POST',body:JSON.stringify({presentItemIds,reason}),
  });
}
export function logout(token:string){
  return request<void>('/auth/logout',token,{method:'POST'});
}
