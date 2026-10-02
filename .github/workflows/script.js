const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const TYPES={panel:"Panel",stack_panel:"Stack Panel",collection_panel:"Collection Panel",scrolling_panel:"Scrolling Panel",image:"Image",label:"Label",button:"Button",input_panel:"Input Panel",toggle:"Toggle",custom:"Custom"};
const state={zip:null,files:new Map(),packName:"",manifest:null,currentPath:null,currentJson:null,currentRoot:null,selected:null,nodeMap:new Map(),urls:new Map(),dirty:false,grid:false,preview:false,zoom:.8,history:[],future:[],projectMeta:{}};

function status(t,cls=""){const e=$("#status");e.textContent=t;e.className=cls}
function clone(x){return JSON.parse(JSON.stringify(x))}
function basename(p){return p.split("/").pop()}
function ext(p){return (p.split(".").pop()||"").toLowerCase()}
function normalizePath(p){return p.replaceAll("\\","/").replace(/^\.\/+/,"")}
function isJsonPath(p){return ext(p)==="json"}
function isUiPath(p){return /^ui\//i.test(p)||/\/ui\//i.test(p)}
function isImagePath(p){return ["png","jpg","jpeg","webp"].includes(ext(p))}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}

async function importPack(file){
  if(!window.JSZip){alert("JSZip não carregou. Abra a página com internet para importar .mcpack/.zip.");return}
  status("Lendo pack...");
  try{
    const zip=await JSZip.loadAsync(file);
    state.zip=zip; state.files.clear(); state.urls.forEach(u=>URL.revokeObjectURL(u)); state.urls.clear();
    let count=0;
    for(const [rawPath,entry] of Object.entries(zip.files)){
      const path=normalizePath(rawPath); if(entry.dir)continue;
      state.files.set(path,entry); count++;
    }
    state.packName=file.name.replace(/\.(mcpack|mcaddon|zip)$/i,"");
    await readManifest();
    renderFiles();
    $("#packInfo").innerHTML=`<b>${escapeHtml(state.packName)}</b><br>${count} arquivos${state.manifest?.header?.name?`<br><span class="muted">${escapeHtml(state.manifest.header.name)}</span>`:""}`;
    status(`Pack importado: ${count} arquivos`,"success");
  }catch(e){console.error(e);status("Falha ao importar pack","error");alert("Não consegui ler esse arquivo como ZIP/MC Pack.");}
}
async function readManifest(){
  const entry=[...state.files.entries()].find(([p])=>basename(p).toLowerCase()==="manifest.json")?.[1];
  if(!entry){state.manifest=null;return}
  try{state.manifest=JSON.parse(await entry.async("text"))}catch{state.manifest=null}
}
function renderFiles(){
  const root=$("#fileTree");root.innerHTML="";
  const search=($("#fileSearch").value||"").toLowerCase();
  const paths=[...state.files.keys()].filter(p=>!search||p.toLowerCase().includes(search)).sort();
  const tree={};
  for(const p of paths){let cur=tree;const parts=p.split("/");parts.forEach((part,i)=>{if(!cur[part])cur[part]={__path:parts.slice(0,i+1).join("/"),__dir:i<parts.length-1,__children:{}};if(i<parts.length-1)cur=cur[part].__children})}
  function walk(obj,parent,depth){
    Object.values(obj).sort((a,b)=>a.__dir===b.__dir?(a.__path.localeCompare(b.__path)):a.__dir?-1:1).forEach(item=>{
      const row=document.createElement("div");row.className="treeitem indent";row.style.paddingLeft=(7+depth*13)+"px";
      row.innerHTML=`<span class="icon ${item.__dir?"folder":"jsonfile"}">${item.__dir?"▾":isUiPath(item.__path)&&isJsonPath(item.__path)?"◇":"•"}</span><span>${escapeHtml(basename(item.__path))}</span>`;
      if(item.__dir){row.onclick=()=>{const c=row.nextElementSibling;c?.classList.toggle("hidden")};parent.appendChild(row);const child=document.createElement("div");parent.appendChild(child);walk(item.__children,child,depth+1)}
      else {row.title=item.__path;row.onclick=()=>openFile(item.__path);if(item.__path===state.currentPath)row.classList.add("selected");parent.appendChild(row)}
    })
  }
  walk(tree,root,0);
}
async function openFile(path){
  if(!isJsonPath(path)){status("Somente JSON pode ser editado visualmente.");return}
  if(state.dirty&&!confirm("Há alterações não exportadas. Abrir outro JSON mesmo assim?"))return;
  const entry=state.files.get(path); if(!entry)return;
  try{
    const txt=await entry.async("text");state.currentPath=path;state.currentJson=JSON.parse(txt);state.currentRoot=state.currentJson;state.selected=null;state.dirty=false;
    $("#currentFile").textContent=path;$("#rawJson").value=JSON.stringify(state.currentJson,null,2);
    buildNodeMap();renderHierarchy();renderCanvas();renderProperties();renderFiles();status("JSON carregado");
  }catch(e){alert("JSON inválido ou não suportado.");status("JSON inválido","error")}
}
function findControls(obj,path=[],out=[]){
  if(!obj||typeof obj!=="object")return out;
  if(Array.isArray(obj)){obj.forEach((v,i)=>findControls(v,path.concat(i),out));return out}
  for(const [k,v] of Object.entries(obj)){
    if(k==="controls" && v && typeof v==="object"){
      if(Array.isArray(v))v.forEach((c,i)=>{if(c&&typeof c==="object"){out.push({path:path.concat(k,i),node:c,key:i})}});
      else Object.entries(v).forEach(([name,c])=>{if(c&&typeof c==="object")out.push({path:path.concat(k,name),node:c,key:name})});
    }
    if(v&&typeof v==="object")findControls(v,path.concat(k),out);
  }
  return out;
}
function getAt(obj,path){return path.reduce((a,k)=>a?.[k],obj)}
function parentAt(obj,path){return getAt(obj,path.slice(0,-1))}
function setAt(obj,path,val){const p=parentAt(obj,path);if(p!=null)p[path[path.length-1]]=val}
function delAt(obj,path){const p=parentAt(obj,path);if(p==null)return;const k=path[path.length-1];if(Array.isArray(p))p.splice(k,1);else delete p[k]}
function buildNodeMap(){
  state.nodeMap.clear();const found=findControls(state.currentJson);
  found.forEach((x,i)=>{const n=x.node;const id="n"+i;state.nodeMap.set(id,{...x,id,name:x.key,typeGuess:typeOf(n)})});
}
function typeOf(n){
  if(!n||typeof n!=="object")return"custom";
  if(n.type)return String(n.type).toLowerCase();
  if(n.texture||n.texture_path)return"image";
  if(n.text!==undefined)return"label";
  if(n.button_mappings||n.sound_name)return"button";
  if(n.toggle_name)return"toggle";
  return"panel";
}
function pathLabel(path){return path.map(x=>typeof x==="number"?`[${x}]`:x).join(".")}
function renderHierarchy(){
  const h=$("#hierarchy");h.innerHTML="";
  if(!state.currentJson){h.innerHTML='<div class="empty">Abra um JSON de interface.</div>';return}
  const found=[...state.nodeMap.values()];
  if(!found.length){h.innerHTML='<div class="empty">Nenhum "controls" foi encontrado. Use a aba JSON para editar estruturas especiais.</div>';return}
  const q=($("#nodeSearch").value||"").toLowerCase();
  found.filter(x=>!q||String(x.name).toLowerCase().includes(q)||String(x.typeGuess).toLowerCase().includes(q)).forEach(x=>{
    const row=document.createElement("div");row.className="treeitem"+(state.selected?.id===x.id?" selected":"");row.innerHTML=`<span class="icon">◈</span><span>${escapeHtml(x.name)}</span><span class="muted" style="margin-left:auto">${escapeHtml(x.typeGuess)}</span>`;
    row.onclick=()=>selectNode(x.id);h.appendChild(row)
  })
}
function selectNode(id){state.selected=state.nodeMap.get(id);renderHierarchy();renderCanvas();renderProperties();document.querySelector('[data-tab="properties"]')?.click()}
function readNum(v,def=0){const n=parseFloat(v);return Number.isFinite(n)?n:def}
function parsePair(v,def=[0,0]){
  if(Array.isArray(v))return [readNum(v[0]),readNum(v[1])];
  if(typeof v==="string"){const a=v.split(/\s*,\s*/).map(Number);if(a.length>=2&&a.every(Number.isFinite))return a.slice(0,2)}
  return def
}
function pairValue(v){return Array.isArray(v)?`${v[0]??0}, ${v[1]??0}`:typeof v==="string"?v:"0, 0"}
function setProp(k,val){
  if(!state.selected)return;
  snapshot();
  const n=state.selected.node;
  if(k==="offset"||k==="size"){const p=val.split(",").map(x=>readNum(x.trim()));n[k]=[p[0]||0,p[1]||0]}
  else if(k==="alpha")n[k]=readNum(val,1);
  else n[k]=val;
  state.dirty=true;$("#rawJson").value=JSON.stringify(state.currentJson,null,2);buildNodeMap();renderHierarchy();renderCanvas();renderProperties();status("Alteração feita")
}
function snapshot(){state.history.push(JSON.stringify(state.currentJson));if(state.history.length>40)state.history.shift();state.future=[]}
function undo(){if(!state.history.length)return;state.future.push(JSON.stringify(state.currentJson));state.currentJson=JSON.parse(state.history.pop());state.currentRoot=state.currentJson;buildNodeMap();renderAll();state.dirty=true}
function redo(){if(!state.future.length)return;state.history.push(JSON.stringify(state.currentJson));state.currentJson=JSON.parse(state.future.pop());buildNodeMap();renderAll();state.dirty=true}
function renderProperties(){
  const p=$("#properties");p.innerHTML="";
  if(!state.selected){p.innerHTML='<div class="empty">Selecione um elemento na hierarquia ou no canvas.</div>';return}
  const n=state.selected.node;
  const group=(title,html)=>{const d=document.createElement("div");d.className="propgroup";d.innerHTML=`<h4>${title}</h4>${html}`;p.appendChild(d)};
  const input=(label,key,val,type="text")=>`<div class="prop"><label>${label}</label><input data-key="${key}" type="${type}" value="${escapeHtml(val)}"></div>`;
  group("Identificação",input("Nome","__name",state.selected.name)+input("Tipo","type",n.type||state.selected.typeGuess));
  group("Layout",input("Offset","offset",pairValue(n.offset))+input("Tamanho","size",pairValue(n.size))+input("Anchor from","anchor_from",n.anchor_from||"")+input("Anchor to","anchor_to",n.anchor_to||"")+input("Layer","layer",n.layer??0,"number"));
  group("Estado",`<div class="prop bool"><label>Visível</label><input data-key="visible" type="checkbox" ${n.visible===false?"":"checked"}></div><div class="prop bool"><label>Ativo</label><input data-key="enabled" type="checkbox" ${n.enabled===false?"":"checked"}></div>`+input("Alpha","alpha",n.alpha??1,"number"));
  group("Conteúdo",input("Texto","text",n.text??"")+input("Texture","texture",n.texture??n.texture_path??"")+input("Font","font_type",n.font_type??""));
  group("Ações",`<button id="duplicateNode">Duplicar</button> <button id="deleteNode">Excluir</button>`);
  p.querySelectorAll("[data-key]").forEach(el=>{
    el.addEventListener("change",()=>{
      const k=el.dataset.key;
      if(k==="visible"||k==="enabled"){snapshot();n[k]=el.checked;state.dirty=true;renderCanvas();$("#rawJson").value=JSON.stringify(state.currentJson,null,2);return}
      if(k==="__name"){renameNode(state.selected,el.value);return}
      setProp(k,el.value)
    })
  });
  $("#deleteNode").onclick=deleteSelected;$("#duplicateNode").onclick=duplicateSelected
}
function renameNode(sel,name){
  snapshot();const p=sel.path;const par=parentAt(state.currentJson,p);if(par&&typeof par==="object"&&!Array.isArray(par)){const old=p[p.length-1];if(name&&name!==old){par[name]=par[old];delete par[old]}}else sel.node.name=name;state.dirty=true;buildNodeMap();renderAll()
}
function deleteSelected(){if(!state.selected)return;if(!confirm("Excluir este elemento?"))return;snapshot();delAt(state.currentJson,state.selected.path);state.selected=null;state.dirty=true;buildNodeMap();renderAll()}
function duplicateSelected(){
  if(!state.selected)return;snapshot();const sel=state.selected,p=sel.path,par=parentAt(state.currentJson,p);if(!par||typeof par!=="object")return;
  if(Array.isArray(par)){par.push(clone(sel.node))}
  else{let base=String(p[p.length-1])+"_copy",name=base,i=2;while(par[name])name=base+i++;par[name]=clone(sel.node)}
  state.dirty=true;buildNodeMap();renderAll()
}
function addElement(type){
  if(!state.currentJson){alert("Abra um JSON primeiro.");return}
  snapshot();const found=findControls(state.currentJson);let target=null;
  if(state.selected?.node?.controls)target=state.selected.node.controls;
  if(!target){const first=found[0];if(first){target=first.node.controls||(first.node.controls={})}else{alert('Este JSON não possui uma estrutura "controls" reconhecível. Use a aba JSON.');return}}
  const name="new_"+type+"_"+Date.now().toString().slice(-4);
  const node={type,offset:[20,20],size:type==="label"?[160,30]:[120,40]};
  if(type==="label")node.text="Novo texto";
  if(type==="image")node.texture="";
  if(type==="button")node.text="Botão";
  if(Array.isArray(target))target.push(node);else target[name]=node;
  state.dirty=true;buildNodeMap();renderAll();status("Elemento adicionado")
}
function renderToolbox(){
  const t=$("#toolbox");t.innerHTML="";
  Object.entries(TYPES).forEach(([k,v])=>{const b=document.createElement("button");b.textContent=v;b.onclick=()=>addElement(k);t.appendChild(b)})
}
async function textureUrl(ref){
  if(!ref)return null;
  let r=String(ref).replace(/^\/+/,"").replace(/\?.*$/,"");
  const candidates=[r,r+".png",r.replace(/^textures\//,"")+" .png".trim()];
  for(const c of candidates){
    const key=[...state.files.keys()].find(p=>p.toLowerCase()===c.toLowerCase()||p.toLowerCase()===c.toLowerCase().replace(/^textures\//,"textures/"));
    if(key){
      if(state.urls.has(key))return state.urls.get(key);
      const blob=await state.files.get(key).async("blob");const u=URL.createObjectURL(blob);state.urls.set(key,u);return u
    }
  }
  return null
}
function getSize(n,screenW,screenH){
  const s=parsePair(n.size,[100,30]);let w=s[0],h=s[1];
  if(w<=0)w=100;if(h<=0)h=30;
  return [w,h]
}
function getPos(n,screenW,screenH){
  const o=parsePair(n.offset,[0,0]);let x=o[0],y=o[1];
  const a=n.anchor_from||"top_left";
  if(String(a).includes("right"))x=screenW+o[0]-(parsePair(n.size,[100,30])[0]||100);
  else if(String(a).includes("center"))x=screenW/2+o[0];
  if(String(a).includes("bottom"))y=screenH+o[1]-(parsePair(n.size,[100,30])[1]||30);
  else if(String(a).includes("center"))y=screenH/2+o[1];
  return [x,y]
}
async function renderCanvas(){
  const screen=$("#screen");screen.innerHTML="";
  if(!state.currentJson){$("#emptyCanvas").style.display="block";return}
  $("#emptyCanvas").style.display="none";
  const preset=$("#screenPreset").value;const dims=preset==="landscape"?[960,540]:preset==="portrait"?[540,960]:[390,844];
  screen.style.width=dims[0]+"px";screen.style.height=dims[1]+"px";screen.style.transform=`scale(${state.zoom})`;
  const found=[...state.nodeMap.values()];
  for(const x of found){
    const n=x.node;if(n.visible===false)continue;
    const [w,h]=getSize(n,...dims),[left,top]=getPos(n,...dims);
    const el=document.createElement("div");el.className="node";el.style.left=left+"px";el.style.top=top+"px";el.style.width=w+"px";el.style.height=h+"px";el.style.opacity=n.alpha??1;el.dataset.id=x.id;
    if(x.typeGuess==="button")el.classList.add("buttonnode");if(x.typeGuess==="toggle")el.classList.add("toggle");
    if(x.typeGuess==="image"){
      const ref=n.texture||n.texture_path;
      const u=await textureUrl(ref);
      if(u){const im=document.createElement("img");im.src=u;el.appendChild(im)}else el.classList.add("imageplaceholder");
    }else if(n.text!==undefined){const tx=document.createElement("div");tx.className="node-text";tx.textContent=String(n.text);el.appendChild(tx)}
    const lab=document.createElement("div");lab.className="node-label";lab.textContent=String(x.name);el.appendChild(lab);
    if(state.selected?.id===x.id)el.classList.add("selected");
    el.addEventListener("pointerdown",e=>dragStart(e,x.id,el));screen.appendChild(el)
  }
}
function dragStart(e,id,el){
  if(state.preview)return; e.preventDefault();selectNode(id);const n=state.nodeMap.get(id).node;const start=[e.clientX,e.clientY],orig=parsePair(n.offset,[0,0]);const move=ev=>{const dx=(ev.clientX-start[0])/state.zoom,dy=(ev.clientY-start[1])/state.zoom;n.offset=[Math.round(orig[0]+dx),Math.round(orig[1]+dy)];state.dirty=true;$("#rawJson").value=JSON.stringify(state.currentJson,null,2);renderCanvas();renderProperties();};const up=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);snapshot();};document.addEventListener("pointermove",move);document.addEventListener("pointerup",up,{once:true})
}
function renderAll(){renderHierarchy();renderCanvas();renderProperties();$("#rawJson").value=state.currentJson?JSON.stringify(state.currentJson,null,2):"";renderFiles()}
function applyRaw(){
  try{const obj=JSON.parse($("#rawJson").value);snapshot();state.currentJson=obj;state.currentRoot=obj;state.dirty=true;state.selected=null;buildNodeMap();renderAll();status("JSON aplicado","success")}catch(e){alert("JSON inválido: "+e.message)}
}
async function exportPack(){
  if(!state.zip){alert("Importe um .mcpack/.mcaddon/.zip primeiro.");return}
  if(state.currentPath&&state.currentJson){
    state.zip.file(state.currentPath,JSON.stringify(state.currentJson,null,2));
    state.files.set(state.currentPath,state.zip.file(state.currentPath));
  }
  status("Gerando pack...");
  try{
    const blob=await state.zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:6}});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=state.packName+"_edited.mcpack";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);
    state.dirty=false;status("Pack exportado","success")
  }catch(e){console.error(e);alert("Falha ao exportar.");status("Falha ao exportar","error")}
}
function saveProject(){
  const project={version:2,packName:state.packName,currentPath:state.currentPath,currentJson:state.currentJson,meta:{savedAt:new Date().toISOString()}};
  const blob=new Blob([JSON.stringify(project,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(state.packName||"jsonui-project")+".jfmproject";a.click()
}
async function loadProject(file){try{const p=JSON.parse(await file.text());state.packName=p.packName||"";state.currentPath=p.currentPath||null;state.currentJson=p.currentJson||null;state.currentRoot=state.currentJson;buildNodeMap();renderAll();status("Projeto carregado")}catch{alert("Projeto inválido.")}}
function newProject(){if(!confirm("Limpar o editor?"))return;location.reload()}
function switchTab(name){
  const isRight=["hierarchy","properties","raw"].includes(name),panel=isRight?$(".right"):$(".left");
  $$(".panel").forEach(p=>p.classList.remove("mobileopen"));panel.classList.add("mobileopen");
  $$(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
  ["files","toolbox","hierarchy","properties","raw"].forEach(n=>{const e=$("#"+n+"Tab");if(e)e.classList.toggle("hidden",n!==name)})
}
$("#importPackBtn").onclick=()=>$("#packInput").click();$("#packInput").onchange=e=>e.target.files[0]&&importPack(e.target.files[0]);
$("#exportPackBtn").onclick=exportPack;$("#saveBtn").onclick=saveProject;$("#newBtn").onclick=newProject;
$("#fileSearch").oninput=renderFiles;$("#nodeSearch").oninput=renderHierarchy;$("#applyRaw").onclick=applyRaw;
$("#zoom").oninput=e=>{state.zoom=readNum(e.target.value)/100;renderCanvas()};$("#gridBtn").onclick=()=>{$("#stageWrap").classList.toggle("gridon")};
$("#previewBtn").onclick=()=>{state.preview=!state.preview;document.body.classList.toggle("previewing",state.preview);$("#previewBtn").textContent=state.preview?"Editar":"Preview"};
$("#screenPreset").onchange=renderCanvas;
$$(".tab").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));$$(".bottomnav button").forEach(b=>b.onclick=()=>switchTab(b.dataset.mobile));
$("#projectInput").onchange=e=>e.target.files[0]&&loadProject(e.target.files[0]);
document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();undo()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();redo()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();saveProject()}if(e.key==="Delete"&&!["INPUT","TEXTAREA"].includes(document.activeElement.tagName))deleteSelected()});
renderToolbox();renderAll();status("V2 pronto — importe seu .mcpack/.mcaddon/.zip");
