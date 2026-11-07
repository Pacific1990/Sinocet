/* Offline shell caching: no API, no credentials, no personal information. */
const CACHE='smtr-shell-v2';
const SCOPE='/smtr/';
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([SCOPE, SCOPE+'manifest.webmanifest', SCOPE+'icon.svg'])));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('smtr-shell-')&&k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin||!url.pathname.startsWith(SCOPE)||
     url.pathname.startsWith(SCOPE+'api/')||url.pathname.startsWith(SCOPE+'ws'))return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(SCOPE,copy));}
      return response;
    }).catch(()=>caches.match(SCOPE)));
    return;
  }
  event.respondWith(caches.match(req).then(existing=>existing||fetch(req).then(response=>{
    if(response.ok&&['script','style','image','font','manifest'].includes(req.destination)){
      const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(req,copy));
    }
    return response;
  })));
});
