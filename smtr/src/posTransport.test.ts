import {afterEach,describe,expect,it,vi} from 'vitest';
import {authenticatedFetch,forgetSession,rememberSession,selectOrganization} from './posTransport';
afterEach(()=>{forgetSession('original');vi.unstubAllGlobals();});
describe('shared POS transport',()=>{
 it('keeps the organization scope through access token renewal',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response('{}',{status:401})).mockResolvedValueOnce(new Response(JSON.stringify({success:true,data:{accessToken:'renewed',refreshToken:'next'}}))).mockResolvedValueOnce(new Response('{"success":true}'));
  vi.stubGlobal('fetch',fetch);rememberSession('original','refresh');selectOrganization('original','42');
  const response=await authenticatedFetch('/sales','original',{headers:{Authorization:'Bearer original'}});
  expect(response.status).toBe(200);
  expect(fetch.mock.calls[0][0]).toBe('/ekolabs/pos/api/v1/workspaces/smtr/sales');
  expect(fetch.mock.calls[1][0]).toBe('/ekolabs/pos/api/v1/auth/refresh');
  expect(fetch.mock.calls[2][1].headers).toMatchObject({Authorization:'Bearer renewed','x-organization-id':'42'});
 });
 it('keeps authentication on the POS auth path without an invented workspace login',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetch);
  await authenticatedFetch('/auth/login',null,{method:'POST'});
  expect(fetch.mock.calls[0][0]).toBe('/ekolabs/pos/api/v1/auth/login');
  expect(fetch.mock.calls[0][1]).toMatchObject({credentials:'omit',cache:'no-store'});
 });
 it('does not retry a rejected refresh indefinitely',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response('{}',{status:401}));vi.stubGlobal('fetch',fetch);rememberSession('original','refresh','42');
  expect((await authenticatedFetch('/stocks','original')).status).toBe(401);expect(fetch).toHaveBeenCalledTimes(2);
 });
});
