import { authenticatedFetch, rememberSession, selectOrganization, forgetSession } from './posTransport';
import { isRole, type Role } from './permissions';

export interface AuthenticatedUser {
  id: string;
  name: string;
  role: Role;
  twoFactorVerified: boolean;
}
export type Organization={id:string;name:string;role:Role};
export interface Session {
  organizationId:string;
  organizations:Organization[];
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


export async function request<T>(path: string, token: string | null, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await authenticatedFetch(path, token, {
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
  if (!body || typeof body!=='object' || !('success' in body) || body.success!==true) throw new ApiError('Reponse POS invalide.',502);
  return ('data' in body?body.data:undefined) as T;
}

export async function activateOrganization(session:Session,organizationId:string):Promise<Session>{
  const organization=session.organizations.find(x=>x.id===organizationId);
  if(!organization)throw new ApiError('Entreprise POS non autorisee.',403);
  selectOrganization(session.accessToken,organizationId);
  const access=await request<{role:Role}>('/access/me',session.accessToken);
  if(!isRole(access.role))throw new ApiError('Profil POS non reconnu.',403);
  return {...session,organizationId,user:{...session.user,role:access.role}};
}
export async function login(email:string,password:string,otp?:string):Promise<Session>{
  const data=await request<{accessToken:string;refreshToken:string;user:{id:number|string;username:string;twoFactorVerified:boolean};enrollmentRequired?:boolean}>('/auth/login',null,{method:'POST',body:JSON.stringify({username:email,password,workspace:'SMTR',...(otp?{otp}:{})})});
  if(data.enrollmentRequired)throw new MfaEnrollmentRequired();
  if(!data?.accessToken||!data.refreshToken||!data.user)throw new ApiError('Authentification POS invalide.',502);
  return sessionFromPOS(data);
}
async function sessionFromPOS(data:{accessToken:string;refreshToken:string;user:{id:number|string;username:string;twoFactorVerified:boolean}}):Promise<Session>{
  rememberSession(data.accessToken,data.refreshToken);
  try{
    const context=await request<{organizations:Organization[]}>('/auth/context',data.accessToken);
    const organizations=context.organizations.filter(x=>isRole(x.role));
    if(!organizations.length)throw new ApiError('Aucun espace SMTR actif pour ce compte POS.',403);
    const session:Session={accessToken:data.accessToken,organizationId:'',organizations,user:{id:String(data.user.id),name:data.user.username,role:organizations[0].role,twoFactorVerified:data.user.twoFactorVerified===true}};
    return organizations.length===1?activateOrganization(session,organizations[0].id):session;
  }catch(e){forgetSession(data.accessToken);throw e;}
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
export async function logout(token:string){
  try { await request<void>('/auth/logout',token,{method:'POST'}); } finally { forgetSession(token); }
}

export type MfaEnrollment={secret:string;enrollmentToken:string;uri:string};
export class MfaEnrollmentRequired extends Error {constructor(){super('Configurez la double authentification POS.');}}
export function setupMfa(username:string,password:string){return request<MfaEnrollment>('/auth/mfa/setup',null,{method:'POST',body:JSON.stringify({username,password})});}
export async function confirmMfa(enrollmentToken:string,otp:string):Promise<Session>{
 const data=await request<{accessToken:string;refreshToken:string;user:{id:number|string;username:string;twoFactorVerified:boolean}}>('/auth/mfa/confirm',null,{method:'POST',body:JSON.stringify({enrollmentToken,otp})});
 return sessionFromPOS(data);
}
