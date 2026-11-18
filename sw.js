const CACHE="laupixels-shell-v5",IMAGE_CACHE="laupixels-images-v1";
const SHELL=["./","./index.html","./manifest.webmanifest","./icon.svg"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>![CACHE,IMAGE_CACHE].includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
 const u=new URL(e.request.url); if(e.request.method!=="GET")return;
 if(u.origin===location.origin && (u.pathname.endsWith("/admin.html") || u.pathname.endsWith("/admin.js")))return;\n if(u.origin===location.origin){
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(res=>{if(res.ok){const c=res.clone();caches.open(CACHE).then(cache=>cache.put(e.request,c));}return res;}).catch(()=>caches.match("./index.html"))));
 }else if(u.hostname==="images.unsplash.com"){
  e.respondWith(caches.open(IMAGE_CACHE).then(async cache=>{const hit=await cache.match(e.request);if(hit)return hit;const res=await fetch(e.request);if(res.ok){await cache.put(e.request,res.clone());const keys=await cache.keys();while(keys.length>40){await cache.delete(keys.shift());}}return res;}));
 }
});