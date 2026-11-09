export const POS_BASE=(import.meta.env.VITE_POS_API_BASE_URL||'/ekolabs/pos/api/v1').replace(/\/+$/,'');
type Credentials={accessToken:string;refreshToken:string;organizationId:string;renewal?:Promise<void>};
const sessions=new Map<string,Credentials>();
export function rememberSession(token:string,refreshToken:string,organizationId=''){sessions.set(token,{accessToken:token,refreshToken,organizationId});}
export function selectOrganization(token:string,id:string){const session=sessions.get(token);if(session)session.organizationId=id;}
export function forgetSession(token:string){sessions.delete(token);}
export function posUrl(path:string){return POS_BASE+(path.startsWith('/auth/')?path:'/workspaces/smtr'+path);}
export function authorization(token:string){const session=sessions.get(token);return {Authorization:'Bearer '+(session?.accessToken||token),...(session?.organizationId?{'x-organization-id':session.organizationId}:{})};}
export async function authenticatedFetch(path:string,token:string|null,options:RequestInit={}):Promise<Response>{
 const send=()=>fetch(posUrl(path),{...options,headers:{Accept:'application/json',...options.headers,...(token?authorization(token):{})},cache:'no-store',credentials:'omit'});
 let response=await send();const session=token?sessions.get(token):undefined;
 if(response.status===401&&session&&!path.startsWith('/auth/')){
  if(!session.renewal)session.renewal=(async()=>{
   const res=await fetch(POS_BASE+'/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:session.refreshToken}),cache:'no-store',credentials:'omit'});
   const body=await res.json();if(!res.ok||!body.success||!body.data?.accessToken)throw new Error('Session POS expiree');
   session.accessToken=body.data.accessToken;session.refreshToken=body.data.refreshToken;
  })().finally(()=>{session.renewal=undefined;});
  try{await session.renewal;response=await send();}catch{return response;}
 }
 return response;
}
