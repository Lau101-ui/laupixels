const $ = id => document.getElementById(id);
const state = { token: sessionStorage.getItem("laupixels_admin_token") || "", api: localStorage.getItem("laupixels_admin_api") || "", busy: false };
const cleanBase = value => {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Use an HTTPS API URL.");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Enter only the API origin, without a path, query or credentials.");
  return url.origin;
};
function status(id, message, kind="") { const el=$(id); el.textContent=message; el.className="status"+(kind?" "+kind:""); }
function setLoggedIn(value) {
  $("loginPanel").classList.toggle("hidden",value);
  $("dashboard").classList.toggle("hidden",!value);
  $("logout").classList.toggle("hidden",!value);
}
async function api(path, options={}) {
  if (!state.api) throw new Error("Set the backend API URL first.");
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set("Authorization","Bearer "+state.token);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type","application/json");
  const response = await fetch(state.api+path,{...options,headers});
  const data = response.status===204 ? null : await response.json().catch(()=>({error:"invalid_server_response"}));
  if (response.status===401) { logout(); throw new Error("Admin session expired. Sign in again."); }
  if (!response.ok) throw new Error(data?.error || "Request failed ("+response.status+").");
  return data;
}
function logout() {
  state.token=""; sessionStorage.removeItem("laupixels_admin_token"); setLoggedIn(false);
}
function slugify(value) { return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,100); }
$("apiBase").value=state.api;
$("saveApi").addEventListener("click",()=>{
  try { state.api=cleanBase($("apiBase").value.trim()); localStorage.setItem("laupixels_admin_api",state.api); status("connectionStatus","API URL saved in this browser.","ok"); }
  catch(e){ status("connectionStatus",e.message,"error"); }
});
$("loginForm").addEventListener("submit",async event=>{
  event.preventDefault(); status("loginStatus","Signing in…");
  try {
    state.api=cleanBase($("apiBase").value.trim()); localStorage.setItem("laupixels_admin_api",state.api);
    const result=await api("/v1/admin/login",{method:"POST",body:JSON.stringify({email:$("email").value.trim(),password:$("password").value})});
    state.token=result.accessToken; sessionStorage.setItem("laupixels_admin_token",state.token);
    $("password").value=""; setLoggedIn(true); status("loginStatus",""); await loadWallpapers();
  } catch(e){ status("loginStatus",e.message,"error"); }
});
$("logout").addEventListener("click",logout);
$("title").addEventListener("input",()=>{ if(!$("slug").dataset.edited) $("slug").value=slugify($("title").value); });
$("slug").addEventListener("input",()=>{ $("slug").dataset.edited="1"; $("slug").value=slugify($("slug").value); });
$("wallForm").addEventListener("submit",async event=>{
  event.preventDefault(); if(state.busy)return;
  const file=$("image").files[0];
  if(!file)return;
  if(!["image/jpeg","image/png","image/webp"].includes(file.type)){status("uploadStatus","Choose a JPEG, PNG or WebP image.","error");return;}
  if(file.size<1||file.size>15*1024*1024){status("uploadStatus","The image must be smaller than 15 MB.","error");return;}
  state.busy=true; $("uploadButton").disabled=true;
  try {
    status("uploadStatus","1/3 — Requesting a secure, short-lived upload…");
    const intent=await api("/v1/admin/uploads",{method:"POST",body:JSON.stringify({contentType:file.type,sizeBytes:file.size})});
    const form=new FormData();
    form.append("file",file); form.append("fileName",intent.uploadOptions.fileName);
    form.append("folder",intent.uploadOptions.folder); form.append("useUniqueFileName","false");
    form.append("token",intent.uploadAuth.token); form.append("expire",String(intent.uploadAuth.expire));
    form.append("signature",intent.uploadAuth.signature); form.append("publicKey",intent.uploadAuth.publicKey);
    status("uploadStatus","2/3 — Uploading and processing image…");
    const uploadedResponse=await fetch("https://upload.imagekit.io/api/v1/files/upload",{method:"POST",body:form});
    const uploaded=await uploadedResponse.json().catch(()=>({}));
    if(!uploadedResponse.ok||!uploaded.fileId) throw new Error(uploaded.message||"Image upload failed.");
    const completed=await api("/v1/admin/uploads/"+encodeURIComponent(intent.uploadId)+"/complete",{method:"POST",body:JSON.stringify({fileId:uploaded.fileId})});
    status("uploadStatus","3/3 — Saving wallpaper record…");
    const record=await api("/v1/admin/wallpapers",{method:"POST",body:JSON.stringify({
      slug:$("slug").value.trim(),title:$("title").value.trim(),description:$("description").value.trim(),
      category:$("category").value.trim(),imageUploadId:completed.uploadId,isPublished:$("published").checked
    })});
    $("wallForm").reset(); $("slug").dataset.edited="";
    status("uploadStatus","Created “"+record.title+"” successfully.","ok");
    await loadWallpapers();
  } catch(e){ status("uploadStatus",e.message,"error"); }
  finally {state.busy=false;$("uploadButton").disabled=false;}
});
async function loadWallpapers(){
  $("wallList").innerHTML="<p class='muted'>Loading catalogue…</p>";
  try {
    const result=await api("/v1/admin/wallpapers?limit=50");
    $("wallList").replaceChildren();
    if(!result.data.length){$("wallList").innerHTML="<p class='muted'>No wallpaper records yet.</p>";return;}
    for(const item of result.data){
      const row=document.createElement("article");row.className="wall";
      const img=document.createElement("img");img.src=item.previewUrl||item.imageUrl;img.alt="";img.loading="lazy";
      const detail=document.createElement("div");
      const title=document.createElement("strong");title.textContent=item.title;
      const meta=document.createElement("div");meta.className="meta";meta.textContent=item.category+" · "+item.slug;
      const pill=document.createElement("span");pill.className="pill"+(item.isPublished?" live":"");pill.textContent=item.isPublished?"PUBLISHED":"DRAFT";
      detail.append(title,meta,pill);
      const actions=document.createElement("div");actions.className="actions row";
      const toggle=document.createElement("button");toggle.className="btn";toggle.textContent=item.isPublished?"UNPUBLISH":"PUBLISH";
      toggle.addEventListener("click",async()=>{toggle.disabled=true;try{await api("/v1/admin/wallpapers/"+encodeURIComponent(item.id),{method:"PATCH",body:JSON.stringify({isPublished:!item.isPublished})});await loadWallpapers();}catch(e){status("listStatus",e.message,"error");toggle.disabled=false;}});
      const remove=document.createElement("button");remove.className="btn danger";remove.textContent="DELETE";
      remove.addEventListener("click",async()=>{if(!confirm("Delete “"+item.title+"”? This removes the database record. It does not yet clean up its ImageKit files."))return;remove.disabled=true;try{await api("/v1/admin/wallpapers/"+encodeURIComponent(item.id),{method:"DELETE"});await loadWallpapers();}catch(e){status("listStatus",e.message,"error");remove.disabled=false;}});
      actions.append(toggle,remove);row.append(img,detail,actions);$("wallList").append(row);
    }
    status("listStatus",result.data.length+" records loaded.","ok");
  }catch(e){$("wallList").innerHTML="<p class='muted'>Could not load wallpaper records.</p>";status("listStatus",e.message,"error");}
}
$("refresh").addEventListener("click",loadWallpapers);
if(state.token){setLoggedIn(true);loadWallpapers().catch(()=>logout());}
else setLoggedIn(false);
