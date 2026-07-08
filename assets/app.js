/* Elden Ring — Ultimate Region Tracker
 * One save file -> per-region view of items (with where-to-find), bosses and graces.
 * Save parsing extracts two things from the .sl2:
 *  - inventory ids  (get_slot_ls / getInventory / getIdReversed)  -> items
 *  - event flags    (getEventFlags + bit-test math)               -> bosses / graces / cookbooks ...
 */

// ---------- data source paths (app lives at the project root) ----------
const A  = ".";           // game data + images live in ./assets
const CK = "assets/json";  // event-flag json (bosses, graces, ...) copied in here

// ---------- module state ----------
let FILE_BUF = null;          // ArrayBuffer of the whole save
let DB = {};                  // all loaded json
let MODEL = null;             // assembled { regions:{}, misc:{}, collectibles:[] }
let isDlcFile = false;        // set during inventory parse (8 vs 16 byte chunks)
const UI = { filter:"all", sort:"default", q:"", reveal:true, auto:false,
             cats:{bosses:true, graces:true, items:true},
             base:true, dlc:true };

/* =====================================================================
 *  SAVE FILE PARSING
 * ===================================================================== */
const INV_PATTERN     = new Uint8Array([0xB0,0xAD,0x01,0x00,0x01,0xFF,0xFF,0xFF]);
const INV_PATTERN_DLC = new Uint8Array([0xB0,0xAD,0x01,0x00,0x01]);

function buffer_equal(b1,b2){
  if(b1.byteLength!==b2.byteLength) return false;
  const d1=new Int8Array(b1), d2=new Int8Array(b2);
  for(let i=0;i<b1.byteLength;i++) if(d1[i]!==d2[i]) return false;
  return true;
}
function subfinder(list,pat){
  for(let i=0;i<list.byteLength;i++)
    if(list[i]===pat[0] && buffer_equal(list.subarray(i,i+pat.byteLength),pat)) return i;
}
function get_slot_ls(dat){
  return [
    dat.subarray(0x00000310,0x0028030f+1), dat.subarray(0x00280320,0x050031f+1),
    dat.subarray(0x00500330,0x078032f+1),  dat.subarray(0x00780340,0x0a0033f+1),
    dat.subarray(0x00a00350,0x0c8034f+1),  dat.subarray(0x00c80360,0x0f0035f+1),
    dat.subarray(0x00f00370,0x118036f+1),  dat.subarray(0x01180380,0x140037f+1),
    dat.subarray(0x01400390,0x168038f+1),  dat.subarray(0x016803a0,0x190039f+1),
  ];
}
function getInventory(slot){
  let index = subfinder(slot,INV_PATTERN) + INV_PATTERN.byteLength + 8;
  if(!index){
    index = subfinder(slot,INV_PATTERN_DLC) + INV_PATTERN_DLC.byteLength + 3;
    isDlcFile = true;
  }
  const end = subfinder(slot.subarray(index,slot.byteLength), new Uint8Array(50).fill(0)) + index + 6;
  return slot.subarray(index,end);
}
function getEventFlags(slot){
  let o=0; const view=new DataView(slot.buffer,slot.byteOffset,slot.byteLength);
  o+=4+4+0x18;
  for(let i=0;i<0x1400;i++){
    const item_id=view.getUint32(o+4,true); o+=8;
    if(item_id!==0 && (item_id&0xf0000000)===0) o+=13;
    else if(item_id!==0 && (item_id&0xf0000000)===0x10000000) o+=8;
  }
  o+=432; o+=0xd0; o+=88; o+=116; o+=88;
  o+=4+(0xa80*12)+4+(0x180*12)+4+4;
  o+=116; o+=140; o+=24;
  const projectile_count=view.getInt32(o,true); o+=4+projectile_count*8;
  o+=156; o+=8; o+=4; o+=0x12f;
  o+=4+(0x780*12)+4+(0x80*12)+4+4;
  o+=256;
  const regions_count=view.getUint32(o,true); o+=4+regions_count*4;
  o+=40; o+=77; o+=0x1008; o+=0x34;
  o+=4+4+(0x1b58*16);
  o+=0x408; o+=0x1d;
  return slot.subarray(o,o+0x1bf99f);
}
function splitChunks(list,size){
  const out=[]; for(let i=0;i<list.length;i+=size) out.push(list.slice(i,i+size)); return out;
}
function decimalToHex(d,pad=2){ let h=Number(d).toString(16); while(h.length<pad) h="0"+h; return h; }
function getIdReversed(id){
  const t=id.slice(0,4).reverse(); let s=""; for(let i=0;i<4;i++) s+=decimalToHex(t[i],2); return s;
}
function getNames(buf){
  const dec=new TextDecoder("utf-8");
  const offs=[0x1901d0e,0x1901f5a,0x19021a6,0x19023f2,0x190263e,0x190288a,0x1902ad6,0x1902d22,0x1902f6e,0x19031ba];
  return offs.map(off=>dec.decode(new Int8Array(Array.from(new Uint16Array(buf.slice(off,off+32))))).replaceAll("\x00",""));
}
function parseSlot(slotIndex){
  isDlcFile=false;
  const bytes=new Uint8Array(FILE_BUF);
  const slot=get_slot_ls(bytes)[slotIndex];
  const inv=Array.from(getInventory(slot));
  const event_flags=getEventFlags(slot);
  const id_list=splitChunks(inv,isDlcFile?8:16).map(r=>getIdReversed(r).toUpperCase());
  return { event_flags, id_list, slot };
}

/* event-flag bit test (bosses / graces / cookbooks / bell_bearings / whetblades) */
function flagOwned(event_flags, flagId){
  const id=parseInt(flagId,10);
  const bst=DB.bst[Math.floor(id/1000)];
  if(bst===undefined) return false;
  const off=bst*125 + Math.floor((id%1000)/8);
  const bit=7-(id%8);
  return (event_flags[off] & (1<<bit))!==0;
}

/* =====================================================================
 *  DATA LOADING  (handles UTF-8 and UTF-16 json transparently)
 * ===================================================================== */
async function loadJson(url){
  const buf=await (await fetch(url)).arrayBuffer();
  const b=new Uint8Array(buf); let text;
  if(b[0]===0xFF&&b[1]===0xFE) text=new TextDecoder("utf-16le").decode(b);
  else if(b[0]===0xFE&&b[1]===0xFF) text=new TextDecoder("utf-16be").decode(b);
  else text=new TextDecoder("utf-8").decode(b);
  if(text.charCodeAt(0)===0xFEFF) text=text.slice(1);
  return JSON.parse(text);
}
async function loadAll(){
  const [data,dlcData,collectibles,region_map,boss_meta,
         bosses,graces,cookbooks,bell,whet,tools,gestures,tears,bst,dlcItems] =
    await Promise.all([
      loadJson(`${A}/assets/json/data.json`),
      loadJson(`${A}/assets/json/dlcData.json`),
      loadJson(`${A}/assets/json/collectibles.json`),
      loadJson(`data/region_map.json`),
      loadJson(`data/boss_meta.json`),
      loadJson(`${CK}/bosses.json`),
      loadJson(`${CK}/graces.json`),
      loadJson(`${CK}/cookbooks.json`),
      loadJson(`${CK}/bell_bearings.json`),
      loadJson(`${CK}/whetblades.json`),
      loadJson(`${CK}/tools.json`),
      loadJson(`${CK}/gestures.json`),
      loadJson(`${CK}/crystal_tears.json`),
      loadJson(`${CK}/eventflag_bst.json`),
      loadJson(`${CK}/dlc_items.json`),
    ]);
  DB = {
    items:data, dlcItemsData:dlcData, collectibles, region_map, boss_meta, bst,
    bosses:{...bosses.bosses, ...(dlcItems.bosses||{})},
    graces:{...graces.graces, ...(dlcItems.graces||{})},
    cookbooks:{...cookbooks.cookbooks, ...(dlcItems.cookbooks||{})},
    bell_bearings:{...bell.bell_bearings, ...(dlcItems.bell_bearings||{})},
    whetblades:{...whet.whetblades, ...(dlcItems.whetblades||{})},
    tools:{...tools.tools, ...(dlcItems.tools||{})},
    gestures:{...gestures.gestures, ...(dlcItems.gestures||{})},
    crystal_tears:{...tears.crystal_tears, ...(dlcItems.crystal_tears||{})},
    dlcBossIds:new Set(Object.keys(dlcItems.bosses||{})),
    dlcGraceIds:new Set(Object.keys(dlcItems.graces||{})),
  };
}

/* =====================================================================
 *  MODEL ASSEMBLY
 * ===================================================================== */
function sanitizeImgName(name){
  if(name.includes("Bell Bearing")) return "Bell Bearing";
  if(name.includes("Note:")) return "Note";
  let n=name.replaceAll(":","").replaceAll("?","");
  const i=n.search(" \\["); if(i>0) n=n.substring(0,i);
  return n;
}
function wikiURL(name){
  if(name==="Gauntlets") return "Chain+Gauntlets";
  return "https://eldenring.wiki.fextralife.com/"+name
    .replaceAll(" +1","").replaceAll(" +2","").replaceAll(" (1)","").replaceAll(" (2)","")
    .replaceAll("[","(").replaceAll("]",")").replaceAll(" ","+");
}
function bossWikiURL(name){
  const base=name.split(/[\/]/)[0].replace(/\s*\(.*?\)\s*/g,"").trim();
  return "https://eldenring.wiki.fextralife.com/"+base.replaceAll(" ","+");
}

function newRegion(name,isDlc){
  return { name, isDlc, bosses:[], graces:[], zones:{} };
}
function buildModel(parsed){
  const {event_flags,id_list,slot}=parsed;
  const owned=new Set(id_list);
  const rm=DB.region_map;
  const dlcSet=new Set(rm.dlcRegions);
  const regions={};
  const region=(name)=>{
    if(!name) name="Other";
    if(!regions[name]) regions[name]=newRegion(name,dlcSet.has(name));
    return regions[name];
  };

  // ---- items (region -> zone -> item) from both data files ----
  for(const src of [DB.items, DB.dlcItemsData]){
    for(const [regName,zones] of Object.entries(src)){
      const R=region(regName);
      for(const [zone,items] of Object.entries(zones)){
        for(const [id,it] of Object.entries(items)){
          (R.zones[zone]=R.zones[zone]||[]).push({
            name:it.name, type:it.type||"chest", hint:it.hint||"",
            owned:owned.has(id)
          });
        }
      }
    }
  }
  // ---- bosses ----
  for(const [id,b] of Object.entries(DB.bosses)){
    const meta=DB.boss_meta[id]||{};
    region(meta.region||"Other").bosses.push({
      name:b.name, location:meta.location||meta.zone||"", zone:meta.zone||"",
      defeated:flagOwned(event_flags,id), wiki:bossWikiURL(b.name)
    });
  }
  // ---- graces ----
  for(const [id,g] of Object.entries(DB.graces)){
    const reg=rm.graceSubcatToRegion[g.subcategory]||"Other";
    region(reg).graces.push({
      name:g.name, zone:g.subcategory||"", found:flagOwned(event_flags,id),
      wiki:"https://eldenring.wiki.fextralife.com/Sites+of+Grace"
    });
  }

  // ---- misc global categories ----
  const misc={};
  const flagCat=(key,label)=>{
    misc[label]=Object.entries(DB[key]).map(([id,v])=>({
      name:v.name, owned:flagOwned(event_flags,id),
      isDlc:false // event-flag misc rarely region/dlc-split; treated as global
    }));
  };
  const invCat=(key,label)=>{
    misc[label]=Object.entries(DB[key]).map(([id,v])=>({
      name:v.name, owned:owned.has(id.toUpperCase()), isDlc:false
    }));
  };
  flagCat("cookbooks","Cookbooks");
  flagCat("bell_bearings","Bell Bearings");
  flagCat("whetblades","Whetblades");
  invCat("tools","Tools");
  invCat("gestures","Gestures");
  invCat("crystal_tears","Crystal Tears");

  // ---- quantifiable collectibles (counts via raw slot scan) ----
  const collectibles=DB.collectibles.map(item=>{
    let count=0;
    for(let i=0;i<slot.byteLength-4;i++){
      if(slot[i]===item.id[0]&&slot[i+1]===item.id[1]&&slot[i+2]===item.id[2]&&slot[i+3]===176){
        count=slot[i+4]; break;
      }
    }
    return { name:item.name, have:count, total:item.places.length, places:item.places };
  });

  MODEL={ regions, misc, collectibles, order:rm.order };
}

/* =====================================================================
 *  RENDERING
 * ===================================================================== */
const el=(id)=>document.getElementById(id);

function passFilter(done){
  if(UI.filter==="todo") return !done;
  if(UI.filter==="done") return done;
  return true;
}
function matchQ(name){ return !UI.q || name.toLowerCase().includes(UI.q); }

function sortEntries(arr,doneKey,nameKey){
  const a=[...arr];
  if(UI.sort==="name") a.sort((x,y)=>x[nameKey].localeCompare(y[nameKey]));
  else if(UI.sort==="status") a.sort((x,y)=>(x[doneKey]?1:0)-(y[doneKey]?1:0));
  return a;
}

function bossEntry(b){
  const cls=b.defeated?"done":"todo";
  const loc=b.location?`<span class="loc">${b.location}</span>`:"";
  return `<div class="entry ${cls}">
    <span class="state ${b.defeated?"y":"n"}">${b.defeated?"✔":"○"}</span>
    <span class="nm"><a href="${b.wiki}" target="_blank" rel="noopener">${b.name}</a>${loc}</span>
  </div>`;
}
function graceEntry(g){
  const cls=g.found?"done":"todo";
  const z=g.zone?`<span class="loc">${g.zone}</span>`:"";
  return `<div class="entry ${cls}">
    <span class="state ${g.found?"y":"n"}">${g.found?"✔":"○"}</span>
    <span class="nm">${g.name}${z}</span>
  </div>`;
}
function itemEntry(it){
  if(it.owned){
    return `<div class="entry done">
      <span class="ic"><img loading="lazy" alt="" src="${A}/assets/img/items/${sanitizeImgName(it.name)}.webp"
        onerror="this.onerror=null;this.src='${A}/assets/img/hints/${it.type}.png'"/></span>
      <span class="nm"><a href="${wikiURL(it.name)}" target="_blank" rel="noopener">${it.name}</a></span>
    </div>`;
  }
  // missing
  if(UI.reveal){
    return `<div class="entry todo tip">
      <span class="ic"><img alt="" src="${A}/assets/img/hints/${it.type}.png"/></span>
      <span class="nm">${it.name}<span class="loc">${it.type}</span>
        ${it.hint?`<span class="tiptext">${it.hint}</span>`:""}</span>
    </div>`;
  }
  return `<div class="entry todo tip">
    <span class="ic"><img alt="" src="${A}/assets/img/hints/${it.type}.png"/></span>
    <span class="nm">??????????${it.hint?`<span class="tiptext">${it.hint}</span>`:""}</span>
  </div>`;
}

function countPair(arr,doneKey){
  const done=arr.filter(x=>x[doneKey]).length; return [done,arr.length];
}

function renderRegion(R){
  // gather counts (respect category toggles for overall %, but always compute per-cat)
  const bossArr=R.bosses, graceArr=R.graces;
  const itemArr=[].concat(...Object.values(R.zones));
  const [bd,bt]=countPair(bossArr,"defeated");
  const [gd,gt]=countPair(graceArr,"found");
  const [idn,itt]=countPair(itemArr,"owned");

  let done=0,total=0;
  if(UI.cats.bosses){done+=bd;total+=bt;}
  if(UI.cats.graces){done+=gd;total+=gt;}
  if(UI.cats.items){done+=idn;total+=itt;}
  const pct=total?Math.floor(done/total*100):100;

  // build body sections
  let body="";
  // bosses
  if(UI.cats.bosses && bt){
    const list=sortEntries(bossArr.filter(b=>passFilter(b.defeated)&&matchQ(b.name)),"defeated","name");
    if(list.length) body+=`<div class="subsec"><h3>Bosses <span class="c">${bd}/${bt}</span></h3>
      <div class="rows">${list.map(bossEntry).join("")}</div></div>`;
  }
  // graces
  if(UI.cats.graces && gt){
    const list=sortEntries(graceArr.filter(g=>passFilter(g.found)&&matchQ(g.name)),"found","name");
    if(list.length) body+=`<div class="subsec"><h3>Sites of Grace <span class="c">${gd}/${gt}</span></h3>
      <div class="rows">${list.map(graceEntry).join("")}</div></div>`;
  }
  // items (grouped by zone)
  if(UI.cats.items && itt){
    let zoneHtml="";
    const zoneNames=Object.keys(R.zones).sort();
    for(const z of zoneNames){
      let items=R.zones[z].filter(it=>passFilter(it.owned)&&matchQ(it.name));
      if(!items.length) continue;
      if(UI.sort==="name") items=[...items].sort((a,b)=>a.name.localeCompare(b.name));
      else if(UI.sort==="status") items=[...items].sort((a,b)=>(a.owned?1:0)-(b.owned?1:0));
      const [zd,zt]=[R.zones[z].filter(i=>i.owned).length,R.zones[z].length];
      zoneHtml+=`<div class="zone-title">${z} <span class="c">(${zd}/${zt})</span></div>
        <div class="rows">${items.map(itemEntry).join("")}</div>`;
    }
    if(zoneHtml) body+=`<div class="subsec"><h3>Items <span class="c">${idn}/${itt}</span></h3>${zoneHtml}</div>`;
  }

  if(!body) return ""; // nothing matches current filter -> hide region entirely

  const badges=[];
  if(bt) badges.push(`<span class="badge ${bd===bt?"full":""}">⚔ ${bd}/${bt}</span>`);
  if(gt) badges.push(`<span class="badge ${gd===gt?"full":""}">✦ ${gd}/${gt}</span>`);
  if(itt) badges.push(`<span class="badge ${idn===itt?"full":""}">🎒 ${idn}/${itt}</span>`);

  return `<section class="region ${R.isDlc?"dlc":""}" data-region="${R.name}">
    <div class="region-head" onclick="this.parentNode.classList.toggle('open')">
      <span class="caret">▶</span>
      <span class="region-title">${R.name}${R.isDlc?'<span class="dlc-tag">DLC</span>':""}</span>
      <span class="badges">${badges.join("")}</span>
      <span class="region-pct">${pct}%</span>
    </div>
    <div class="region-body">${body}</div>
  </section>`;
}

function renderMisc(){
  // collectibles + flag/inventory categories, as a global block
  let inner="";
  // quantifiable collectibles
  const coll=MODEL.collectibles.filter(c=>matchQ(c.name) &&
    (UI.filter==="all" || (UI.filter==="done"?c.have>=c.total:c.have<c.total)));
  if(coll.length){
    inner+=`<div class="subsec"><h3>Collectibles <span class="c">quantities</span></h3><div class="rows">`+
      coll.map(c=>`<div class="entry ${c.have>=c.total?"done":"todo"}">
        <span class="state ${c.have>=c.total?"y":"n"}">${c.have}/${c.total}</span>
        <span class="nm">${c.name}<span class="loc">${c.places.join(", ")}</span></span></div>`).join("")+
      `</div></div>`;
  }
  for(const [label,arr] of Object.entries(MODEL.misc)){
    const list=arr.filter(x=>passFilter(x.owned)&&matchQ(x.name));
    if(!list.length) continue;
    const [d,t]=countPair(arr,"owned");
    const sorted=UI.sort==="status"?[...list].sort((a,b)=>(a.owned?1:0)-(b.owned?1:0)):
                 UI.sort==="name"?[...list].sort((a,b)=>a.name.localeCompare(b.name)):list;
    inner+=`<div class="subsec"><h3>${label} <span class="c">${d}/${t}</span></h3><div class="rows">`+
      sorted.map(x=>`<div class="entry ${x.owned?"done":"todo"}">
        <span class="state ${x.owned?"y":"n"}">${x.owned?"✔":"○"}</span>
        <span class="nm">${x.name}</span></div>`).join("")+`</div></div>`;
  }
  if(!inner) return "";
  return `<section class="region" data-region="__misc">
    <div class="region-head" onclick="this.parentNode.classList.toggle('open')">
      <span class="caret">▶</span>
      <span class="region-title">Global &amp; Miscellaneous</span>
      <span class="badges"><span class="badge">not tied to a region</span></span>
    </div><div class="region-body">${inner}</div></section>`;
}

function render(){
  if(!MODEL) return;
  // remember which regions are currently expanded so a re-render keeps them open
  const openRegions=new Set([...el("results").querySelectorAll(".region.open")].map(r=>r.dataset.region));
  let html="";
  let gDone=0,gTotal=0;
  for(const name of MODEL.order){
    const R=MODEL.regions[name];
    if(!R) continue;
    if(R.isDlc && !UI.dlc) continue;
    if(!R.isDlc && !UI.base) continue;
    // overall counts
    if(UI.cats.bosses){gDone+=R.bosses.filter(b=>b.defeated).length;gTotal+=R.bosses.length;}
    if(UI.cats.graces){gDone+=R.graces.filter(g=>g.found).length;gTotal+=R.graces.length;}
    if(UI.cats.items){const it=[].concat(...Object.values(R.zones));gDone+=it.filter(i=>i.owned).length;gTotal+=it.length;}
    html+=renderRegion(R);
  }
  // any regions not in order (safety)
  for(const [name,R] of Object.entries(MODEL.regions)){
    if(MODEL.order.includes(name)) continue;
    if(R.isDlc&&!UI.dlc) continue; if(!R.isDlc&&!UI.base) continue;
    html+=renderRegion(R);
  }
  html+=renderMisc();

  el("results").innerHTML = html || `<p class="empty">Nothing matches the current filters.</p>`;

  // restore expanded state
  el("results").querySelectorAll(".region").forEach(r=>{
    if(openRegions.has(r.dataset.region)) r.classList.add("open");
  });

  const pct=gTotal?Math.floor(gDone/gTotal*100):0;
  el("overallPct").textContent=pct+"%";
  el("overallBar").style.width=pct+"%";
  el("overallCounts").textContent=`${gDone} / ${gTotal} tracked (bosses, graces & items across shown regions)`;
}

/* =====================================================================
 *  FILE HANDLING  (live re-read via the File System Access API when available)
 * ===================================================================== */
const HAS_FS = "showOpenFilePicker" in window;   // Chrome / Edge
let fileHandle = null;                            // FileSystemFileHandle we can re-read
let helperPath = null;                            // save path served by the local Python helper
let helperSaves = [];                             // saves reported by GET /api/saves
let lastMtime = 0;                                // last-seen save modified time (for auto-refresh)
let autoTimer = null;                             // auto-refresh polling interval
let refreshing = false;                           // guard against overlapping refreshes

function showError(msg){ const e=el("loadError"); e.textContent=msg; e.hidden=false; }

// --- tiny IndexedDB store so the picked file survives a page reload ---
const IDB_NAME="er-tracker", IDB_STORE="handles", IDB_KEY="saveFile";
function idbOpen(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(IDB_NAME,1);
    r.onupgradeneeded=()=>r.result.createObjectStore(IDB_STORE);
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
  });
}
async function idbSet(v){ try{ const db=await idbOpen(); await new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,"readwrite");tx.objectStore(IDB_STORE).put(v,IDB_KEY);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);}); }catch(e){/* private mode etc. */} }
async function idbGet(){ try{ const db=await idbOpen(); return await new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,"readonly");const rq=tx.objectStore(IDB_STORE).get(IDB_KEY);rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error);}); }catch(e){ return null; } }

// validate + read an ArrayBuffer into FILE_BUF and populate the slot dropdown
async function ingestBuffer(buf){
  el("loadError").hidden=true;
  if(!buffer_equal(buf.slice(0,4), new Int8Array([66,78,68,52]))){
    showError("That doesn't look like a valid Elden Ring save (missing BND4 header)."); return false;
  }
  FILE_BUF=buf;
  const names=getNames(buf);
  const sel=el("slotSelect");
  sel.innerHTML=`<option hidden selected value="">Select a character…</option>`;
  names.forEach((n,i)=>{
    const o=document.createElement("option");
    o.value=i; o.textContent=n||`(empty slot ${i+1})`; if(!n) o.disabled=true;
    sel.appendChild(o);
  });
  el("slotWrap").hidden=false;
  el("charName").textContent="";
  // pre-select the first non-empty character so it's one click to analyze
  const firstReal=[...sel.options].find(o=>o.value!=="" && !o.disabled);
  el("calculate").hidden = !firstReal;
  if(firstReal) sel.value=firstReal.value;
  return true;
}
async function ingestFile(file){ return ingestBuffer(await file.arrayBuffer()); }

/* --- local helper (server.py): serves the save so refresh works in any browser --- */
async function fetchHelperBuffer(path){
  const r=await fetch("/api/save"+(path?"?path="+encodeURIComponent(path):""),{cache:"no-store"});
  if(!r.ok) throw new Error("the local helper could not read the save");
  return await r.arrayBuffer();
}
async function detectHelper(){
  try{
    const r=await fetch("/api/saves",{cache:"no-store"});
    if(!r.ok) return false;
    helperSaves=(await r.json()).saves||[];
    return true;
  }catch(e){ return false; }
}
function relTime(ms){
  const s=Math.floor((Date.now()-ms)/1000);
  if(s<90) return "just now";
  if(s<5400) return Math.round(s/60)+" min ago";
  if(s<172800) return Math.round(s/3600)+" h ago";
  return Math.round(s/86400)+" d ago";
}
async function loadFromHelper(path){
  try{
    fileHandle=null; helperPath=path;
    await ingestBuffer(await fetchHelperBuffer(path));
  }catch(err){ console.error(err); showError("Could not load the auto-detected save: "+err.message); }
}

// pick a file via the File System Access API (keeps a re-readable handle)
async function pickFile(){
  try{
    const [h]=await window.showOpenFilePicker({
      types:[{description:"Elden Ring save",accept:{"application/octet-stream":[".sl2",".co2"]}}],
    });
    fileHandle=h; helperPath=null;
    await idbSet(h);
    await ingestFile(await h.getFile());
  }catch(err){
    if(err && err.name==="AbortError") return;   // user cancelled the dialog
    console.error(err); showError("Could not open file: "+err.message);
  }
}

// re-read the previously picked file after a page reload (needs a permission click)
async function reloadLast(){
  try{
    const h=await idbGet(); if(!h) return;
    if(h.queryPermission){
      let p=await h.queryPermission({mode:"read"});
      if(p!=="granted") p=await h.requestPermission({mode:"read"});
      if(p!=="granted"){ showError("Permission to read the file was denied."); return; }
    }
    fileHandle=h;
    await ingestFile(await h.getFile());
  }catch(err){ console.error(err); showError("Could not reload the last save: "+err.message); }
}

async function onCalculate(){
  const slotIndex=+el("slotSelect").value;
  if(Number.isNaN(slotIndex)) return;
  el("calculate").textContent="Reading…";
  try{
    if(!DB.region_map) await loadAll();
    buildModel(parseSlot(slotIndex));
    el("controls").hidden=false;
    el("charName").textContent=el("slotSelect").selectedOptions[0].textContent;
    // "Refresh from disk" works when we have a live source (helper OR file handle)
    el("refreshCtrl").hidden=!(helperPath||fileHandle);
    render();
    await markLoaded();
    el("controls").scrollIntoView({behavior:"smooth"});
  }catch(err){
    console.error(err); showError("Failed to read this save slot: "+err.message);
  }finally{
    el("calculate").textContent="Analyze ▸";
  }
}

// get the latest save bytes from whichever live source is active
async function currentBytes(){
  if(helperPath) return fetchHelperBuffer(helperPath);
  if(fileHandle){
    if(fileHandle.queryPermission){
      let p=await fileHandle.queryPermission({mode:"read"});
      if(p!=="granted") p=await fileHandle.requestPermission({mode:"read"});
      if(p!=="granted") throw new Error("read permission denied");
    }
    return (await fileHandle.getFile()).arrayBuffer();
  }
  return null;
}

// cheap check of the save's modified time (no full read) — for auto-refresh
async function saveStat(){
  try{
    if(helperPath){
      const r=await fetch("/api/stat?path="+encodeURIComponent(helperPath),{cache:"no-store"});
      if(!r.ok) return null;
      return (await r.json()).mtime||null;
    }
    if(fileHandle) return (await fileHandle.getFile()).lastModified||null;
  }catch(e){/* ignore */}
  return null;
}
async function markLoaded(){ const m=await saveStat(); if(m) lastMtime=m; }

// re-read the live save and update the view in place. quiet=true suppresses the
// error banner (used by the background auto-refresh, e.g. during a mid-write read).
async function onRefresh(quiet=false){
  if(refreshing) return;
  const slotIndex=+el("slotSelect").value;
  if(Number.isNaN(slotIndex)) return;
  const btn=el("refreshBtn"), label="↻ Refresh from disk";
  refreshing=true; btn.disabled=true; btn.textContent="↻ Reading…";
  try{
    const buf=await currentBytes();
    if(!buf){                                    // no live source -> fall back to re-picking
      btn.textContent=label; btn.disabled=false; refreshing=false;
      return HAS_FS ? pickFile() : el("savefile").click();
    }
    if(!buffer_equal(buf.slice(0,4), new Int8Array([66,78,68,52]))) throw new Error("file is no longer a valid save");
    FILE_BUF=buf;
    buildModel(parseSlot(slotIndex));
    render();   // keeps expanded regions + current filters
    lastMtime=(await saveStat())||lastMtime;
    el("refreshedAt").textContent="refreshed "+new Date().toLocaleTimeString();
    btn.textContent="✓ Updated"; setTimeout(()=>{btn.textContent=label;},1200);
  }catch(err){
    console.error(err); if(!quiet) showError("Refresh failed: "+err.message); btn.textContent=label;
  }finally{ btn.disabled=false; refreshing=false; }
}

// poll the save's mtime; only do a full re-read when it actually changed
async function autoTick(){
  if(!UI.auto || refreshing || !(helperPath||fileHandle)) return;
  const m=await saveStat();
  if(m && m!==lastMtime) await onRefresh(true);
}
function setAuto(on){
  UI.auto=on;
  if(autoTimer){ clearInterval(autoTimer); autoTimer=null; }
  if(on){
    autoTimer=setInterval(autoTick,10000);   // check every 10s (cheap mtime probe)
    el("refreshedAt").textContent="auto-refresh on — watching for saves…";
  }
}

/* =====================================================================
 *  WIRING
 * ===================================================================== */
async function wire(){
  el("pickBtn").addEventListener("click",()=> HAS_FS ? pickFile() : el("savefile").click());
  el("savefile").addEventListener("change",()=>{ const f=el("savefile").files[0]; if(f){ fileHandle=null; helperPath=null; ingestFile(f); } });
  el("saveSource").addEventListener("change",e=>loadFromHelper(e.target.value));
  el("reloadLast").addEventListener("click",reloadLast);
  el("refreshBtn").addEventListener("click",()=>onRefresh());
  el("tglAuto").addEventListener("change",e=>setAuto(e.target.checked));
  el("slotSelect").addEventListener("change",()=>{ el("calculate").hidden=false; });
  el("calculate").addEventListener("click",onCalculate);

  el("tglBase").addEventListener("change",e=>{UI.base=e.target.checked;render();});
  el("tglDlc").addEventListener("change",e=>{UI.dlc=e.target.checked;render();});
  el("tglBosses").addEventListener("change",e=>{UI.cats.bosses=e.target.checked;render();});
  el("tglGraces").addEventListener("change",e=>{UI.cats.graces=e.target.checked;render();});
  el("tglItems").addEventListener("change",e=>{UI.cats.items=e.target.checked;render();});
  el("filterSel").addEventListener("change",e=>{UI.filter=e.target.value;render();});
  el("sortSel").addEventListener("change",e=>{UI.sort=e.target.value;render();});
  el("tglReveal").addEventListener("change",e=>{UI.reveal=e.target.checked;render();});
  let t; el("searchBox").addEventListener("input",e=>{
    clearTimeout(t); t=setTimeout(()=>{UI.q=e.target.value.trim().toLowerCase();render();},150);
  });
  el("expandAll").addEventListener("click",()=>document.querySelectorAll(".region").forEach(r=>r.classList.add("open")));
  el("collapseAll").addEventListener("click",()=>document.querySelectorAll(".region").forEach(r=>r.classList.remove("open")));

  // Prefer the local helper (server.py) if it's running — auto-loads the save, works in any browser.
  const hasHelper = await detectHelper();
  if(hasHelper && helperSaves.length){
    const sel=el("saveSource");
    sel.innerHTML="";
    helperSaves.forEach(s=>{
      const o=document.createElement("option");
      o.value=s.path;
      o.textContent=`${s.file} · account ${s.account} · saved ${relTime(s.mtime)}`;
      sel.appendChild(o);
    });
    if(helperSaves.length>1) el("saveSourceWrap").hidden=false;   // only show a chooser when there's a choice
    el("pickBtn").textContent="Use a different file…";
    el("autoNote").hidden=false;
    el("autoNote").innerHTML="Save auto-detected. Pick a character and hit <strong>Analyze</strong> — then use <strong>↻ Refresh from disk</strong> anytime to pull the latest progress.";
    await loadFromHelper(helperSaves[0].path);
  } else if(HAS_FS){
    const h=await idbGet(); if(h){ el("reloadLast").hidden=false; }   // one-click reload of last picked file
  }
}
document.addEventListener("DOMContentLoaded",wire);
